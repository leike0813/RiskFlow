/**
 * C30 父运行图（design D-01/D-02/D-05/D-08，IP-03/IP-06）。
 *
 * 单一公共 `RiskFlowGraphStateV1Schema` 之上的真实 LangGraph `StateGraph`：`preparing` → `identification`
 * → `assessment` → `result-summary`。父运行拥有身份，`identify-and-assess` 只把真实父运行引用交给
 * C24 识别子图，并按每条已验收风险记录的精确版本建立**一个**评估子运行；子运行由注入的
 * `WorkflowGraphRuntimePortV1` 执行，父图只启动（同身份重放）并读取它的运行状态。
 *
 * 业务事实只追加进 C30 自有登记面：正文（运行状态/运行汇总）只入 C04，登记行只保存精确引用；
 * checkpoint 只保存公共小型状态，恢复时先读 C30 最新运行状态与已登记事实，再与 checkpoint 对账。
 * 未发生的关系不写空链边；缺空间配对、无合格风险、不可证明的检查点都如实收口，不伪造记录。
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
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ContractReferenceV1,
  type IdentificationPreparationSnapshotRefV1,
  type ResponseRecommendationRefV1,
  type RiskFlowRunResultRefV1,
  type RouteDecisionRefV1,
  type SpatialScopeRefV1,
  type StageResultRefV1,
  type StandardizedRiskRecordRefV1,
  type WaitingRefV1,
  type WorkflowEntryModeV1,
  type WorkflowErrorRefV1,
  type WorkflowReassessmentInputV1,
  type WorkflowRunRefV1,
  type WorkflowRunStatusV1,
} from "@riskflow/contracts/ports";
import type { IdentificationGraphRuntimeV1 } from "@riskflow/core/identification/graph";
import {
  RiskFlowGraphStateV1Schema,
  type IdentificationGraphStateV1,
  type RiskFlowGraphStateV1,
} from "@riskflow/contracts/workflows";
import {
  sha256CanonicalJson,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  WorkflowGraphArtifactBodyV1Schema,
  WorkflowGraphErrorV1Schema,
  WorkflowGraphResultRowV1Schema,
  WorkflowGraphRunStateV1Schema,
  assessmentSubRunIdentityFor,
  classifyWorkflowGraphFailure,
  segmentedAssessmentSubRunIdentityFor,
  workflowEntryIdentityFor,
  type WorkflowAssessmentContextV1,
  type WorkflowGraphArtifactBodyV1,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphErrorCodeV1,
  type WorkflowGraphErrorV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunResultV1,
  type WorkflowGraphRunStateV1,
  type WorkflowGraphRuntimePortV1,
  type WorkflowRunStageV1,
} from "@riskflow/core/workflow";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";

/** 运行上下文在 LangGraph `configurable` 中的稳定键（与其它模块同形，不共用取值）。 */
export const RISK_FLOW_GRAPH_RUN_CONFIG_KEY_V1 = "riskflowRiskFlowGraphRunV1" as const;

/** 阶段顺序：只按此顺序推进，恢复对账只允许“业务领先恰好一格”（design D-08）。 */
const STAGE_SEQUENCE_V1 = ["preparing", "identification", "assessment", "result-summary"] as const;

const NODE_FOR_STAGE_V1 = {
  preparing: "prepare",
  identification: "identification",
  assessment: "assessment",
  "result-summary": "summarize",
} as const;

/** 等待节点名：唯一 `interrupt()` 位置，恢复时先回到同一阶段重放（design D-08）。 */
const WAIT_NODE_V1 = "wait" as const;

type RiskFlowStageV1 = RiskFlowGraphStateV1["stage"];
type NodeNameV1 = (typeof NODE_FOR_STAGE_V1)[RiskFlowStageV1] | typeof WAIT_NODE_V1 | typeof END;

/**
 * 闭合路由原因码（design D-05）：未发生的分支只登记原因码，不写链边、不伪造结论。
 * 只用于本模块登记行的 `routeKind`，不参与公共契约取值。
 */
export const RISK_FLOW_ROUTE_KIND_ENTRY_ACCEPTED_V1 = "entry-accepted" as const;
export const RISK_FLOW_ROUTE_KIND_RISK_ACCEPTED_V1 = "risk-record-accepted" as const;
export const RISK_FLOW_ROUTE_KIND_SUB_RUN_V1 = "assessment-sub-run" as const;
export const RISK_FLOW_ROUTE_KIND_NO_QUALIFIED_RISK_V1 = "no-qualified-risk" as const;
export const RISK_FLOW_ROUTE_KIND_PAIRING_MISSING_V1 = "spatial-pairing-missing" as const;
export const RISK_FLOW_ROUTE_KIND_CANCELLED_V1 = "cancelled" as const;
// 人工采纳决定进入父运行冻结事实的路由原因码（design D2）：与 `ResumeCauseV1` 的
// `human-decision-committed` 成对，取值必须一致，评估子图据此取精确采纳决定引用。
export const RISK_FLOW_ROUTE_KIND_HUMAN_DECISION_COMMITTED_V1 = "human-decision-committed" as const;

/** 逐空间配对上下文：与公共入口载荷同形，入口身份一致性由门禁证明（design D-01）。 */
export type RiskFlowAssessmentPairingV1 = WorkflowAssessmentContextV1;

/**
 * 验收风险 → 精确空间配对（design D-01）：只返回该风险自身空间的精确引用；返回 `undefined`
 * 表示无法证明配对，父图按类型化阻断收口，绝不从其它空间推断或复用别的空间快照。
 */
export interface RiskSpatialPairingResolverV1 {
  resolve(input: {
    readonly projectId: string;
    readonly riskRecordRef: ContractReferenceV1;
    readonly identificationRunRef: WorkflowRunRefV1 | undefined;
    readonly pairings: readonly RiskFlowAssessmentPairingV1[];
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<SpatialScopeRefV1 | undefined>;
}

/** 冻结重试预算读取（design D-08）：次数与退避只来自冻结 `retryPolicyRef`，无内建默认。 */
export interface RiskFlowRetryPolicyReaderV1 {
  read(input: {
    readonly projectId: string;
    readonly retryPolicyRef: VersionReference;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ readonly maxAttempts: number; readonly backoffMs: number } | undefined>;
}

/** 图节点可用的全部注入端口；任一必需项缺失即拒绝构造（组合根负责补齐）。 */
export interface RiskFlowGraphPortsV1 {
  readonly transactionUnit: TransactionUnitV1;
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  readonly bodies: WorkflowGraphBodyPortV1;
  /** C24 识别子图运行面：父运行身份与 C11 准备快照由本图给出（design D-02）。 */
  readonly identificationRuntime: IdentificationGraphRuntimeV1;
  /** 评估子运行运行面（本 change 评估图实现，按注入替换）。 */
  readonly assessmentRuntime: WorkflowGraphRuntimePortV1;
  readonly riskSpatialPairing: RiskSpatialPairingResolverV1;
  readonly retryPolicy: RiskFlowRetryPolicyReaderV1;
  /** 子图冻结版本：由组合根注入的配置身份，不从调用方猜测（design D-02）。 */
  readonly subGraphVersions: {
    readonly identification: VersionReference;
    readonly assessment: VersionReference;
  };
  /**
   * 冻结重试策略引用：组合根注入的配置身份。`start` 用命令自带的策略引用，恢复/取消只能取此
   * 配置（登记行不保存策略引用），因此组合根必须与入口使用的策略配置一致。
   */
  readonly retryPolicyRef: VersionReference;
  readonly now: () => Date;
}

/** 一次 `start`/`resume`/`cancel` 的完整调用身份：冻结值全部来自命令或已登记事实。 */
export interface RiskFlowGraphRunContextV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  /** 本运行首次记录时间：派生动作身份与正文时间都用它，重放得到同一事实（design D-08）。 */
  readonly entryRecordedAt: string;
  readonly runRef: WorkflowRunRefV1;
  readonly threadId: string;
  readonly entryMode: WorkflowEntryModeV1;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  /** 逐空间配对；多空间恢复时由登记入口快照行重建（design D-01）。 */
  readonly pairing: readonly RiskFlowAssessmentPairingV1[];
  /** 非识别入口的冻结风险输入（`assess`/`reassess`/`historical-backfill`/…）。 */
  readonly primaryRiskRef?: ContractReferenceV1;
  /** 重评入口不可变事实（design D-12）；非重评不携带。 */
  readonly reassessmentEntry?: WorkflowReassessmentInputV1;
  readonly retryPolicyRef: VersionReference;
  /** 本运行选定的精确图版本（design D-04）：只写入 C30 run-state 工件供读端原样呈现。 */
  readonly graphVersion: VersionReference;
  /** 子图冻结版本：由组合根注入的配置身份，不从调用方猜测。 */
  readonly subGraphVersions: {
    readonly identification: VersionReference;
    readonly assessment: VersionReference;
  };
  /** 本次恢复带来的识别准备快照引用（`engineering.inputs-ready.v1`）。 */
  readonly identificationPreparationSnapshotRef?: IdentificationPreparationSnapshotRefV1;
  /**
   * 人工决定等待门（design D2）：只在以 `waitForDecision` 创建运行的**那一次**命令上出现。
   * 恢复路径由已登记行重建运行上下文，因此不再携带该字段——等待意图只在创建时生效，恢复即继续推进。
   */
  readonly humanDecisionGate?: {
    readonly responseRecommendationRef: ResponseRecommendationRefV1;
    readonly spatialScopeRef: SpatialScopeRefV1;
  };
}

/** 恢复值：只携带稳定引用与原因，不携带自由正文（`wait` 节点消费）。 */
export type RiskFlowResumeValueV1 =
  | {
      readonly kind: "inputs-ready";
      readonly knowledgePreparationTaskRef?: ContractReferenceV1;
      readonly identificationPreparationSnapshotRef?: IdentificationPreparationSnapshotRefV1;
    }
  | {
      readonly kind: "risk-record-accepted";
      readonly identificationRunRef: WorkflowRunRefV1;
      readonly riskRecordRef: ContractReferenceV1;
    }
  | { readonly kind: "assessment-settled"; readonly assessmentRunRef: WorkflowRunRefV1 }
  /** 条件变化后重判（复核已决、任务完成、用户确认等）：只重读已登记事实，不猜测结论。 */
  | {
      readonly kind: "reevaluate";
      readonly reasonCode: string;
      readonly relatedRunRef?: WorkflowRunRefV1;
    }
  | { readonly kind: "transient-recovered" }
  /**
   * 人工采纳决定已成立（design D2）：只携带精确决定路由引用；运行、建议与空间必须由 C41 的
   * 精确采纳证明先行核对，父图不据引用自行推进等待态运行。
   */
  | { readonly kind: "human-decision-committed"; readonly routeDecisionRef: RouteDecisionRefV1 };

/** 首次运行输入：通道正文就是完整公开状态。 */
export interface RiskFlowGraphInputV1 {
  readonly graph: RiskFlowGraphStateV1;
}

/** 编译后父图运行面：只是 LangGraph 调用收口，节点不直接调用它。 */
export interface RiskFlowGraphRunnerV1 {
  invoke(input: RiskFlowGraphInputV1, config: LangGraphRunnableConfig): Promise<unknown>;
  resume(
    input: { readonly resume: RiskFlowResumeValueV1 },
    config: LangGraphRunnableConfig,
  ): Promise<unknown>;
  retry(state: RiskFlowGraphStateV1, config: LangGraphRunnableConfig): Promise<unknown>;
  recover(
    state: RiskFlowGraphStateV1,
    completedNode: RiskFlowGraphStateV1["stage"],
    config: LangGraphRunnableConfig,
  ): Promise<unknown>;
  getState(config: LangGraphRunnableConfig): Promise<unknown>;
}

/** 节点内部失败：只带稳定 C30 错误，不携带上游正文。 */
export class RiskFlowGraphNodeFailureV1 extends Error {
  readonly error: WorkflowGraphErrorV1;

  constructor(error: WorkflowGraphErrorV1) {
    super(`${error.code}:${error.detailCode}`, { cause: error });
    this.name = "RiskFlowGraphNodeFailureV1";
    this.error = error;
  }
}

/** 登记端口报告同键异载荷 / 运行版本不符：不可重试冲突，不覆盖首次业务事实（design D-08）。 */
export class RiskFlowGraphConflictV1 extends Error {
  readonly priorCommandId: string;

  constructor(priorCommandId: string) {
    super(`risk-flow graph registration conflict: ${priorCommandId}`);
    this.name = "RiskFlowGraphConflictV1";
    this.priorCommandId = priorCommandId;
  }
}

/**
 * 字段级通道：通道名必须与 `RiskFlowGraphStateV1` 的字段一一对应。C03 checkpointer 按当前
 * schema 收敛非协议通道，因此这里不引入任何公共 Schema 之外的通道。
 */
const channelsAnnotation = Annotation.Root({
  schemaVersion: Annotation<RiskFlowGraphStateV1["schemaVersion"]>(),
  graphVersion: Annotation<RiskFlowGraphStateV1["graphVersion"]>(),
  runRef: Annotation<RiskFlowGraphStateV1["runRef"]>(),
  threadId: Annotation<RiskFlowGraphStateV1["threadId"]>(),
  entryMode: Annotation<RiskFlowGraphStateV1["entryMode"]>(),
  authorizationContextRef: Annotation<RiskFlowGraphStateV1["authorizationContextRef"]>(),
  status: Annotation<RiskFlowGraphStateV1["status"]>(),
  stage: Annotation<RiskFlowGraphStateV1["stage"]>(),
  identificationRunRef: Annotation<RiskFlowGraphStateV1["identificationRunRef"]>(),
  assessmentRunRefs: Annotation<RiskFlowGraphStateV1["assessmentRunRefs"]>(),
  waitingRefs: Annotation<RiskFlowGraphStateV1["waitingRefs"]>(),
  lastStageResultRef: Annotation<RiskFlowGraphStateV1["lastStageResultRef"]>(),
  lastRouteDecisionRef: Annotation<RiskFlowGraphStateV1["lastRouteDecisionRef"]>(),
  lastErrorRef: Annotation<RiskFlowGraphStateV1["lastErrorRef"]>(),
  resultRef: Annotation<RiskFlowGraphStateV1["resultRef"]>(),
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
const stateAsUpdate = (state: RiskFlowGraphStateV1): GraphChannelsV1 => ({
  schemaVersion: state.schemaVersion,
  graphVersion: state.graphVersion,
  runRef: state.runRef,
  threadId: state.threadId,
  entryMode: state.entryMode,
  authorizationContextRef: state.authorizationContextRef,
  status: state.status,
  stage: state.stage,
  identificationRunRef: state.identificationRunRef,
  assessmentRunRefs: state.assessmentRunRefs,
  waitingRefs: state.waitingRefs,
  lastStageResultRef: state.lastStageResultRef,
  lastRouteDecisionRef: state.lastRouteDecisionRef,
  lastErrorRef: state.lastErrorRef,
  resultRef: state.resultRef,
});

const stageOf = (value: unknown): RiskFlowStageV1 => {
  if (typeof value === "object" && value !== null && "stage" in value) {
    const stage = (value as { readonly stage?: unknown }).stage;
    if (typeof stage === "string") {
      const matched = STAGE_SEQUENCE_V1.find((candidate) => candidate === stage);
      if (matched !== undefined) return matched;
    }
  }
  return "preparing";
};

export const riskFlowGraphError = (input: {
  readonly code: WorkflowGraphErrorCodeV1;
  readonly stage: RiskFlowStageV1;
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

/** 契约不一致：只带稳定详情码，绝不改写成其它错误种类。 */
const contractInvalid = (input: {
  readonly stage: RiskFlowStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 =>
  riskFlowGraphError({ code: "CONTRACT_INVALID", ...input, retryable: false });

/**
 * 登记行与运行状态正文的阶段集合同时容纳评估子运行阶段，父运行只接受自己的四个阶段：
 * 其它取值按契约失败收口（design D-05），绝不把评估阶段写进父运行事实。
 */
export const riskFlowStageOf = (stage: WorkflowRunStageV1, occurredAt: string): RiskFlowStageV1 => {
  const matched = STAGE_SEQUENCE_V1.find((candidate) => candidate === stage);
  if (matched === undefined) {
    throw new RiskFlowGraphNodeFailureV1(
      contractInvalid({ stage: "preparing", detailCode: "run-stage-not-risk-flow", occurredAt }),
    );
  }
  return matched;
};

/** 状态通道唯一解析点：任何失败都收口为 `CONTRACT_INVALID`。 */
export const parseRiskFlowGraphState = (
  value: unknown,
  occurredAt: string,
): RiskFlowGraphStateV1 => {
  const parsed = RiskFlowGraphStateV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new RiskFlowGraphNodeFailureV1(
      riskFlowGraphError({
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
export const readRiskFlowRunContext = (input: {
  readonly config: LangGraphRunnableConfig;
  readonly occurredAt: string;
}): RiskFlowGraphRunContextV1 => {
  const value = input.config.configurable?.[RISK_FLOW_GRAPH_RUN_CONFIG_KEY_V1];
  const candidate =
    typeof value === "object" && value !== null
      ? (value as { readonly commandId?: unknown; readonly projectId?: unknown })
      : undefined;
  if (
    candidate === undefined ||
    typeof candidate.commandId !== "string" ||
    typeof candidate.projectId !== "string"
  ) {
    throw new RiskFlowGraphNodeFailureV1(
      riskFlowGraphError({
        code: "CONTRACT_INVALID",
        stage: "preparing",
        detailCode: "graph-run-context-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return value as RiskFlowGraphRunContextV1;
};

const isResumeValue = (value: unknown): value is RiskFlowResumeValueV1 =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string";

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;

/** 上游端口失败 → C30 稳定错误：只读 code/retryable/blockerKind/detailCode，不匹配文案（D-07）。 */
export const toRiskFlowGraphError = (input: {
  readonly stage: RiskFlowStageV1;
  readonly error: unknown;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 => {
  const { stage, error, occurredAt } = input;
  if (error instanceof RiskFlowGraphConflictV1) {
    return classifyWorkflowGraphFailure({
      stage,
      upstream: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
      detailCode: "registration-idempotency-conflict",
      occurredAt,
    });
  }
  if (error instanceof RiskFlowGraphNodeFailureV1) return error.error;
  const code = readProperty(error, "code");
  if (typeof code !== "string") {
    return classifyWorkflowGraphFailure({
      stage,
      upstream: { code: "TRANSACTION_FAILED", retryable: true },
      detailCode: "unclassified-failure",
      occurredAt,
    });
  }
  const retryable = readProperty(error, "retryable");
  const blockerKind = readProperty(error, "blockerKind");
  const detailCode = readProperty(error, "detailCode");
  return classifyWorkflowGraphFailure({
    stage,
    upstream: { code, retryable: retryable === true },
    detailCode:
      typeof detailCode === "string"
        ? detailCode
        : typeof blockerKind === "string"
          ? blockerKind
          : code.toLowerCase(),
    occurredAt,
  });
};

/** 引用稳定键：`domain-event` 引用没有 `reference`，按其事件身份取值。 */
const refKeyOf = (ref: ContractReferenceV1): string =>
  "reference" in ref
    ? `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`
    : `${ref.kind}/${ref.eventId}/${ref.eventVersion}`;

const refsOfKind = <T extends ContractReferenceV1["kind"]>(
  refs: readonly ContractReferenceV1[],
  kind: T,
): readonly Extract<ContractReferenceV1, { readonly kind: T }>[] =>
  refs.filter(
    (ref): ref is Extract<ContractReferenceV1, { readonly kind: T }> => ref.kind === kind,
  );

const dedupeByKey = <T extends ContractReferenceV1>(refs: readonly T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const ref of refs) {
    const key = refKeyOf(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
};

const dedupeRunRefs = (refs: readonly WorkflowRunRefV1[]): WorkflowRunRefV1[] => {
  const seen = new Set<string>();
  const result: WorkflowRunRefV1[] = [];
  for (const ref of refs) {
    const key = `${ref.reference.entityId}/${ref.reference.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
};

/** 链边身份由运行、两端引用与关系码稳定派生：重放命中同一身份即为同一事实（design D-05）。 */
export const linkIdFor = (input: {
  readonly runId: string;
  readonly fromRef: ContractReferenceV1;
  readonly toRef: ContractReferenceV1;
  readonly relation: string;
}): string => `risk-flow-link:${sha256CanonicalJson(input).slice(0, 48)}`;

/** 阶段结果身份：由运行、阶段与可证明该阶段的事实内容派生，重放得到同一身份。 */
export const stageResultRefFor = (input: {
  readonly runId: string;
  readonly stage: RiskFlowStageV1;
  readonly evidence: unknown;
}): StageResultRefV1 => ({
  kind: "stage-result",
  reference: {
    entityId: `risk-flow-stage-result:${input.runId}:${input.stage}`,
    versionId: sha256CanonicalJson({ stage: input.stage, evidence: input.evidence }),
  },
});

/** 等待引用投影后的稳定键：等待行身份与幂等键都由它派生，重复登记同一等待不产生第二行。 */
const waitingKey = (waiting: WaitingRefV1): string => sha256CanonicalJson(waiting);

const dedupeWaitings = (waitings: readonly WaitingRefV1[]): WaitingRefV1[] => {
  const seen = new Set<string>();
  const result: WaitingRefV1[] = [];
  for (const waiting of waitings) {
    const key = waitingKey(waiting);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(waiting);
  }
  return result;
};

/** 已登记游标：只读 C30 最新运行状态，绝不用 checkpoint 猜测业务状态（design D-08）。 */
export const readRiskFlowCursor = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
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

/** 本运行已登记的全部行：恢复与幂等回查的唯一依据。 */
export const readRiskFlowRows = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
}): Promise<readonly WorkflowGraphResultRowV1[]> =>
  await input.ports.registrationStore.listRunRows({
    projectId: input.run.projectId,
    runId: input.run.runRef.reference.entityId,
  });

/** 逐空间配对登记行：每个空间一条入口快照行，`frozenRefs` 就是该空间的冻结输入（design D-01）。 */
export const pairingFrozenRefsV1 = (input: {
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly pairing: RiskFlowAssessmentPairingV1;
}): readonly ContractReferenceV1[] =>
  dedupeByKey([
    ...refsOfKind(input.frozenRefs, "project-revision"),
    input.pairing.spatialScopeRef,
    ...refsOfKind(input.frozenRefs, "source-version"),
    input.pairing.applicabilityMetadataSnapshotRef,
    // 显式钉住的评估依据集合（`historical-backfill`）必须原样进入子运行冻结输入，
    // 使子运行按该精确版本评估而不是重新解析（design D-01/D-03）。
    ...refsOfKind(input.frozenRefs, "assessment-basis-release-set"),
    ...(input.pairing.monitoringSnapshotRefs ?? []),
  ]);

/** 从登记行重建逐空间配对：只认“恰好一个空间引用”的入口快照行（design D-01/D-08）。 */
export const pairingsFromRowsV1 = (
  rows: readonly WorkflowGraphResultRowV1[],
): readonly RiskFlowAssessmentPairingV1[] => {
  const pairings: RiskFlowAssessmentPairingV1[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.resultKind !== "entry-snapshot") continue;
    const spaces = refsOfKind(row.frozenRefs, "spatial-scope");
    if (spaces.length !== 1) continue;
    const space = spaces[0];
    const applicability = refsOfKind(row.frozenRefs, "applicability-metadata-snapshot")[0];
    if (space === undefined || applicability === undefined) continue;
    const key = refKeyOf(space);
    if (seen.has(key)) continue;
    seen.add(key);
    const monitoring = refsOfKind(row.frozenRefs, "monitoring-snapshot");
    pairings.push({
      spatialScopeRef: space,
      applicabilityMetadataSnapshotRef: applicability,
      ...(monitoring.length === 0 ? {} : { monitoringSnapshotRefs: monitoring }),
    });
  }
  return pairings;
};

/** 识别准备快照引用：只认本运行登记的入口快照行，绝不猜测“最新准备”（design D-02）。 */
export const identificationPreparationFromRowsV1 = (
  rows: readonly WorkflowGraphResultRowV1[],
): IdentificationPreparationSnapshotRefV1 | undefined => {
  for (const row of rows) {
    if (row.resultKind !== "entry-snapshot") continue;
    const matched = refsOfKind(row.frozenRefs, "identification-preparation-snapshot")[0];
    if (matched !== undefined) return matched;
  }
  return undefined;
};

/**
 * 入口冻结引用：本运行已登记行携带的冻结引用并集（恢复时重建运行上下文，design D-08）。
 * 每行的 `frozenRefs` 就是启动该运行时的完整冻结集合，因此分段入口（无逐空间入口快照行）
 * 也能原样重建，不因缺少入口快照行而丢冻结身份。
 */
export const frozenRefsFromRowsV1 = (
  rows: readonly WorkflowGraphResultRowV1[],
  extraRefs: readonly ContractReferenceV1[] = [],
): readonly ContractReferenceV1[] =>
  dedupeByKey([...rows.flatMap((row) => row.frozenRefs), ...extraRefs]);

/** 已验收风险引用：只认本运行登记的精确版本路由行，重复事件不产生第二个身份（design D-02）。 */
export const acceptedRiskRefsFromRowsV1 = (
  rows: readonly WorkflowGraphResultRowV1[],
): StandardizedRiskRecordRefV1[] =>
  dedupeByKey(
    rows
      .filter(
        (row) =>
          row.resultKind === "route-decision" &&
          row.routeKind === RISK_FLOW_ROUTE_KIND_RISK_ACCEPTED_V1,
      )
      .flatMap((row) => refsOfKind(row.frozenRefs, "standardized-risk-record")),
  );

/** 已建立评估子运行的风险：由 `assessment-sub-run` 路由行的稳定身份反查（design D-02）。 */
export const assessmentSubRunRouteIdsV1 = (
  rows: readonly WorkflowGraphResultRowV1[],
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.resultKind !== "route-decision") continue;
    if (row.routeKind !== RISK_FLOW_ROUTE_KIND_SUB_RUN_V1) continue;
    const ref = row.routeDecisionRef;
    if (ref === undefined) continue;
    ids.add(ref.reference.entityId);
  }
  return ids;
};

/** 识别等待：`identify-and-assess` 在 C11 准备快照到达前不创建任何正式评估（design D-02）。 */
export const identificationPreparationWaitingFor = (input: {
  readonly runRef: WorkflowRunRefV1;
}): Extract<WaitingRefV1, { readonly kind: "knowledge-preparation" }> => ({
  kind: "knowledge-preparation",
  knowledgePreparationTaskRef: {
    kind: "knowledge-preparation-task",
    reference: {
      entityId: `knowledge-preparation-task:identification:${input.runRef.reference.entityId}`,
      versionId: sha256CanonicalJson({
        runRef: input.runRef,
        preparationKind: "identification",
      }),
    },
  },
});

/** 子运行路由身份：由父运行与风险引用精确派生，重复事件回查同一身份（design D-02）。 */
export const assessmentSubRunRouteIdFor = (input: {
  readonly runId: string;
  readonly riskRecordRef: ContractReferenceV1;
}): string =>
  `risk-flow-assessment-sub-run:${input.runId}:${sha256CanonicalJson(input.riskRecordRef).slice(0, 32)}`;

/** 空间配对阻断路由身份：同一风险的重复事件得到同一阻断事实。 */
export const pairingBlockedRouteIdFor = (input: {
  readonly runId: string;
  readonly riskRecordRef: ContractReferenceV1;
}): string =>
  `risk-flow-spatial-pairing-blocked:${input.runId}:${sha256CanonicalJson(input.riskRecordRef).slice(0, 32)}`;

/** C24 识别子运行启动命令：同一父运行、准备快照与图版本只对应一个子运行（design D-02）。 */
export const identificationStartCommandFor = (input: {
  readonly run: RiskFlowGraphRunContextV1;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
}): Parameters<IdentificationGraphRuntimeV1["start"]>[0] => {
  const seed = sha256CanonicalJson({
    parentRunRef: input.run.runRef,
    preparationSnapshotRef: input.preparationSnapshotRef,
    graphVersion: input.run.subGraphVersions.identification,
  });
  const commandId = `c30-identification-start:${seed}`;
  return {
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    commandId,
    idempotencyKey: commandId,
    issuedAt: input.run.entryRecordedAt,
    validAt: input.run.entryRecordedAt,
    requestedAt: input.run.entryRecordedAt,
    authorization: input.run.authorization,
    graphVersion: input.run.subGraphVersions.identification,
    parentRiskFlowRunRef: input.run.runRef,
    preparationSnapshotRef: input.preparationSnapshotRef,
    triggerReasonCode: "risk-flow-run-identification",
  };
};

/** 评估子运行入口模式：识别入口派生的子运行按逐风险评估进入（design D-02）。 */
export const assessmentEntryModeFor = (entryMode: WorkflowEntryModeV1): WorkflowEntryModeV1 =>
  entryMode === "identify-and-assess" ? "assess" : entryMode;

/** 评估子运行启动命令：每条已验收风险版本恰一个身份，重复事件重放同一身份（design D-02）。 */
export const assessmentStartCommandFor = (input: {
  readonly run: RiskFlowGraphRunContextV1;
  readonly riskRecordRef: ContractReferenceV1;
  readonly pairing: RiskFlowAssessmentPairingV1;
}): Parameters<WorkflowGraphRuntimePortV1["start"]>[0] => {
  const entryMode = assessmentEntryModeFor(input.run.entryMode);
  const identity = assessmentSubRunIdentityFor({
    projectId: input.run.projectId,
    parentRunRef: input.run.runRef,
    riskRecordRef: input.riskRecordRef,
  });
  const frozenRefs = pairingFrozenRefsV1({
    frozenRefs: input.run.frozenRefs,
    pairing: input.pairing,
  });
  const commandId = `c30-assessment-start:${identity.runRef.reference.versionId}`;
  return {
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    authorization: input.run.authorization,
    commandId,
    idempotencyKey: commandId,
    issuedAt: input.run.entryRecordedAt,
    validAt: input.run.entryRecordedAt,
    graphVersion: input.run.subGraphVersions.assessment,
    retryPolicyRef: input.run.retryPolicyRef,
    runRef: identity.runRef,
    threadId: identity.threadId,
    entryMode,
    entryIdentity: {
      entityId: `workflow-entry:${input.run.projectId}:${entryMode}`,
      versionId: sha256CanonicalJson({
        riskRecordRef: input.riskRecordRef,
        parentRunRef: input.run.runRef,
        frozenRefs: frozenRefs.map(refKeyOf).sort(),
      }),
    },
    frozenRefs,
    parentRunRef: input.run.runRef,
    acceptedRiskRecordRef: input.riskRecordRef,
    spatialScopeRef: input.pairing.spatialScopeRef,
    applicabilityMetadataSnapshotRef: input.pairing.applicabilityMetadataSnapshotRef,
    ...(input.pairing.monitoringSnapshotRefs === undefined
      ? {}
      : { monitoringSnapshotRefs: input.pairing.monitoringSnapshotRefs }),
    ...(input.run.reassessmentEntry === undefined
      ? {}
      : { reassessmentEntry: input.run.reassessmentEntry }),
  };
};

/**
 * 分段入口的评估子运行启动命令（design D-02/D-04）：没有识别阶段与逐空间配对，冻结引用、
 * 风险输入与监测集合直接来自父运行的显式入口，身份由父运行与入口身份派生。
 */
export const segmentedAssessmentStartCommandFor = (input: {
  readonly run: RiskFlowGraphRunContextV1;
}): Parameters<WorkflowGraphRuntimePortV1["start"]>[0] => {
  const pairing = input.run.pairing[0];
  const identity = segmentedAssessmentSubRunIdentityFor({
    projectId: input.run.projectId,
    parentRunRef: input.run.runRef,
    entryMode: input.run.entryMode,
    entryIdentity: input.run.entryIdentity,
  });
  const commandId = `c30-assessment-start:${identity.runRef.reference.versionId}`;
  return {
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    authorization: input.run.authorization,
    commandId,
    idempotencyKey: commandId,
    issuedAt: input.run.entryRecordedAt,
    validAt: input.run.entryRecordedAt,
    graphVersion: input.run.subGraphVersions.assessment,
    retryPolicyRef: input.run.retryPolicyRef,
    runRef: identity.runRef,
    threadId: identity.threadId,
    entryMode: input.run.entryMode,
    entryIdentity: input.run.entryIdentity,
    frozenRefs: input.run.frozenRefs,
    parentRunRef: input.run.runRef,
    ...(input.run.primaryRiskRef === undefined
      ? {}
      : { acceptedRiskRecordRef: input.run.primaryRiskRef }),
    ...(pairing === undefined
      ? {}
      : {
          spatialScopeRef: pairing.spatialScopeRef,
          applicabilityMetadataSnapshotRef: pairing.applicabilityMetadataSnapshotRef,
          ...(pairing.monitoringSnapshotRefs === undefined
            ? {}
            : { monitoringSnapshotRefs: pairing.monitoringSnapshotRefs }),
        }),
    ...(input.run.reassessmentEntry === undefined
      ? {}
      : { reassessmentEntry: input.run.reassessmentEntry }),
  };
};

/** 分段入口的子运行路由身份：同一父运行的唯一子运行，重复事件回查同一身份（design D-02）。 */
export const segmentedSubRunRouteIdFor = (runId: string): string =>
  `risk-flow-segmented-sub-run:${runId}`;

/** 运行状态正文：版本只摘要内容本身、时间只取本运行首次记录时间，同一事实永远同一版本。 */
/**
 * 已登记的重评入口事实（design D-12）：优先使用本轮运行上下文传入的入口事实；本轮未携带
 * 时沿用前一版本已登记的值，保证同一运行的每次 run-state 工件保留同一入口事实。两者都在
 * 且不相等说明同一运行被塞入两份不同入口事实，交由调用方以入口身份核对后失败闭合，不静默
 * 取其一。
 */
const reassessmentEntryConflict = (
  run: RiskFlowGraphRunContextV1,
  previous: WorkflowGraphRunStateV1 | undefined,
): boolean => {
  const registered = previous?.reassessmentEntry;
  const incoming = run.reassessmentEntry;
  if (registered === undefined || incoming === undefined) return false;
  return JSON.stringify(sortEntry(registered)) !== JSON.stringify(sortEntry(incoming));
};

const sortEntry = (entry: WorkflowReassessmentInputV1) => ({
  previousAssessmentRecordRef: entry.previousAssessmentRecordRef,
  reason: entry.reason,
  // ContractReferenceV1 是判别联合，成员形状不同（含 domain-event 等无 reference 变体），
  // 因此按整体 canonical 形态排序，不假设每个成员都有 reference。
  changedInputRefs: [...entry.changedInputRefs].map((ref) => JSON.stringify(ref)).sort(),
});

const reassessmentEntryOf = (
  run: RiskFlowGraphRunContextV1,
  previous: WorkflowGraphRunStateV1 | undefined,
): WorkflowReassessmentInputV1 | undefined => run.reassessmentEntry ?? previous?.reassessmentEntry;

const runStateBody = (input: {
  readonly run: RiskFlowGraphRunContextV1;
  readonly previous: WorkflowGraphRunStateV1 | undefined;
  readonly stage: RiskFlowStageV1;
  readonly status: WorkflowRunStatusV1;
  readonly patch?: {
    readonly identificationRunRef?: WorkflowGraphRunStateV1["identificationRunRef"];
    readonly assessmentRunRefs?: readonly WorkflowRunRefV1[];
    readonly acceptedRiskRecordRefs?: WorkflowGraphRunStateV1["acceptedRiskRecordRefs"];
    readonly assessmentRecordRefs?: WorkflowGraphRunStateV1["assessmentRecordRefs"];
    readonly warningRecordRefs?: WorkflowGraphRunStateV1["warningRecordRefs"];
    readonly responseRecommendationRefs?: WorkflowGraphRunStateV1["responseRecommendationRefs"];
    readonly deviationRecordRefs?: WorkflowGraphRunStateV1["deviationRecordRefs"];
    readonly calibrationSuggestionRefs?: WorkflowGraphRunStateV1["calibrationSuggestionRefs"];
    readonly lastStageResultRef?: WorkflowGraphRunStateV1["lastStageResultRef"];
    readonly lastRouteDecisionRef?: WorkflowGraphRunStateV1["lastRouteDecisionRef"];
    readonly lastWaitingRef?: WorkflowGraphRunStateV1["lastWaitingRef"];
    readonly lastErrorRef?: WorkflowGraphRunStateV1["lastErrorRef"];
    readonly resultRef?: WorkflowGraphRunStateV1["resultRef"];
  };
}): WorkflowGraphRunStateV1 => {
  const patch = input.patch ?? {};
  const previous = input.previous;
  const identificationRunRef = patch.identificationRunRef ?? previous?.identificationRunRef;
  const lastStageResultRef = patch.lastStageResultRef ?? previous?.lastStageResultRef;
  const lastRouteDecisionRef = patch.lastRouteDecisionRef ?? previous?.lastRouteDecisionRef;
  // 等待引用只在等待态保留：离开等待即清空，避免投影读到已不成立的等待（design D-08）。
  const lastWaitingRef =
    input.status === "waiting" ? (patch.lastWaitingRef ?? previous?.lastWaitingRef) : undefined;
  const lastErrorRef = patch.lastErrorRef ?? previous?.lastErrorRef;
  // 运行汇总引用只属于终态完成/取消（公共状态的同一规则）：失败态、运行态与等待态都不得携带，
  // 否则公共状态解析失败（design D-05/D-09）。
  const resultRef =
    input.status === "completed" || input.status === "cancelled"
      ? (patch.resultRef ?? previous?.resultRef)
      : undefined;
  const withoutVersion: Omit<WorkflowGraphRunStateV1, "runVersionId"> = {
    schemaVersion: "1",
    projectId: input.run.projectId,
    runId: input.run.runRef.reference.entityId,
    entryMode: input.run.entryMode,
    entryIdentity: input.run.entryIdentity,
    stage: input.stage,
    status: input.status,
    assessmentRunRefs: dedupeRunRefs(patch.assessmentRunRefs ?? previous?.assessmentRunRefs ?? []),
    acceptedRiskRecordRefs: dedupeByKey(
      patch.acceptedRiskRecordRefs ?? previous?.acceptedRiskRecordRefs ?? [],
    ),
    assessmentRecordRefs: patch.assessmentRecordRefs ?? previous?.assessmentRecordRefs ?? [],
    warningRecordRefs: patch.warningRecordRefs ?? previous?.warningRecordRefs ?? [],
    responseRecommendationRefs:
      patch.responseRecommendationRefs ?? previous?.responseRecommendationRefs ?? [],
    deviationRecordRefs: patch.deviationRecordRefs ?? previous?.deviationRecordRefs ?? [],
    calibrationSuggestionRefs:
      patch.calibrationSuggestionRefs ?? previous?.calibrationSuggestionRefs ?? [],
    recordedAt: input.run.entryRecordedAt,
    // 重评入口事实在每次形成 run-state 工件时保持不变（design D-12）：先取已登记值，
    // 传入值缺失时沿用它，传入值与已登记值不同时按本轮入口为准。非重评不携带该字段。
    ...(reassessmentEntryOf(input.run, previous) === undefined
      ? {}
      : { reassessmentEntry: reassessmentEntryOf(input.run, previous) }),
    // 精确图版本与重评入口同理：每次形成 run-state 工件都写入同一启动值（design D-04）。
    graphVersion: input.run.graphVersion,
    ...(identificationRunRef === undefined ? {} : { identificationRunRef }),
    ...(lastStageResultRef === undefined ? {} : { lastStageResultRef }),
    ...(lastRouteDecisionRef === undefined ? {} : { lastRouteDecisionRef }),
    ...(lastWaitingRef === undefined ? {} : { lastWaitingRef }),
    ...(lastErrorRef === undefined ? {} : { lastErrorRef }),
    ...(resultRef === undefined ? {} : { resultRef }),
  };
  return WorkflowGraphRunStateV1Schema.parse({
    ...withoutVersion,
    runVersionId: sha256CanonicalJson(withoutVersion),
  });
};

/** 运行汇总/等待状态 → 公共图状态：公开状态永远是 C30 已登记事实的投影（design D-08）。 */
export const graphStateOf = (
  run: RiskFlowGraphRunContextV1,
  cursor: WorkflowGraphRunStateV1,
): RiskFlowGraphStateV1 =>
  RiskFlowGraphStateV1Schema.parse({
    schemaVersion: "1",
    graphVersion: { entityId: "risk-flow-graph", versionId: cursor.entryIdentity.versionId },
    runRef: run.runRef,
    threadId: run.threadId,
    entryMode: cursor.entryMode,
    authorizationContextRef: run.authorization.authorizationContextRef,
    status: cursor.status,
    stage: cursor.stage,
    assessmentRunRefs: cursor.assessmentRunRefs,
    waitingRefs: cursor.lastWaitingRef === undefined ? [] : [cursor.lastWaitingRef],
    ...(cursor.identificationRunRef === undefined
      ? {}
      : { identificationRunRef: cursor.identificationRunRef }),
    ...(cursor.lastStageResultRef === undefined
      ? {}
      : { lastStageResultRef: cursor.lastStageResultRef }),
    ...(cursor.lastRouteDecisionRef === undefined
      ? {}
      : { lastRouteDecisionRef: cursor.lastRouteDecisionRef }),
    ...(cursor.lastErrorRef === undefined ? {} : { lastErrorRef: cursor.lastErrorRef }),
    ...(cursor.resultRef === undefined ? {} : { resultRef: cursor.resultRef }),
  });

/** 链边材料：只登记真实成立的相邻关系（design D-05）。 */
interface LinkV1 {
  readonly fromRef: ContractReferenceV1;
  readonly toRef: ContractReferenceV1;
  readonly relation: "parent-child" | "run-stage";
  readonly sourceStage: RiskFlowStageV1;
  readonly stageResultRef?: StageResultRefV1;
}

/** 一次动作的全部事实（登记行 + 链边 + 新运行状态），同一 C03 事务提交（design D-05）。 */
interface AdvanceInputV1 {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly cursor: WorkflowGraphRunStateV1 | undefined;
  readonly stage: RiskFlowStageV1;
  readonly nextStage: RiskFlowStageV1;
  readonly status: WorkflowRunStatusV1;
  readonly actionSuffix: string;
  readonly commandKind: string;
  /** 入口快照行：逐空间冻结输入，每空间一条、由入口身份区分（design D-01）。 */
  readonly entrySnapshots?: readonly {
    readonly entryIdentity: VersionReference;
    readonly frozenRefs: readonly ContractReferenceV1[];
  }[];
  readonly stageResults?: readonly StageResultRefV1[];
  readonly routeDecisions?: readonly {
    readonly ref: RouteDecisionRefV1;
    readonly routeKind: string;
  }[];
  readonly waitings?: readonly WaitingRefV1[];
  readonly workflowErrorRef?: WorkflowErrorRefV1;
  readonly runResult?: WorkflowGraphRunResultV1;
  readonly links?: readonly LinkV1[];
  readonly statePatch?: Parameters<typeof runStateBody>[0]["patch"];
}

/**
 * 推进一格：写运行状态正文（可选运行汇总正文），再在同一 C03 事务登记本动作的全部事实与链边。
 * 事实内容寻址，因此同一动作重放只命中既有行，不产生重复业务事实（design D-05/D-08）。
 */
const advance = async (input: AdvanceInputV1): Promise<RiskFlowGraphStateV1> => {
  const { ports, run } = input;
  const occurredAt = ports.now().toISOString();
  const suffix = input.actionSuffix;
  const runId = run.runRef.reference.entityId;
  // 同一运行被塞入两份不相等的重评入口事实时失败闭合，不静默取其一（design D-12）。
  if (reassessmentEntryConflict(run, input.cursor)) {
    throw new Error("reassessment entry conflicts with the registered run state");
  }
  const runResultArtifactId = `risk-flow-graph-run-result:${runId}:${suffix}`;
  const waitings = dedupeWaitings(input.waitings ?? []);
  const actionId = `${runId}:${suffix}`;
  const auditEntryId = `${actionId}:audit`;
  const runState = runStateBody({
    run,
    previous: input.cursor,
    stage: input.nextStage,
    status: input.status,
    ...(input.statePatch === undefined && waitings.length === 0
      ? {}
      : {
          patch: {
            ...(input.statePatch ?? {}),
            ...(waitings.length === 0 ? {} : { lastWaitingRef: waitings[0] }),
          },
        }),
  });
  // 运行状态正文按**运行版本**寻址：同一运行版本在任何动作下都得到同一工件与同一登记行，
  // 重放命中既有事实；动作后缀只用于运行汇总正文（每次动作一份）。
  const runStateArtifactId = `risk-flow-graph-run-state:${runId}:${runState.runVersionId}`;
  // 全部登记行的幂等键按运行身份限定：入口身份、错误原因等判别值可能被兄弟运行共享，
  // 若幂等键不按运行限定，后一个运行的同一事实会被前一个运行的行吞掉（design D-05/D-08）。
  const artifactRefs = new Map<string, ContentArtifactRefV1>();
  const put = async (artifactId: string, body: WorkflowGraphArtifactBodyV1): Promise<void> => {
    const placed = await ports.bodies.putBody({
      projectId: run.projectId,
      actorId: run.actorId,
      commandId: `${runId}:body:${artifactId}`,
      issuedAt: run.entryRecordedAt,
      artifactId,
      body: WorkflowGraphArtifactBodyV1Schema.parse(body),
      authorization: run.authorization,
    });
    artifactRefs.set(artifactId, ContentArtifactRefV1Schema.parse(placed));
  };
  // 运行状态正文按运行版本不可变：同一版本已登记过就直接复用既有工件引用，不重写正文
  // （重复动作、恢复重放或不同调用授权的同内容推进都命中同一份正文）。
  const priorRunState = await ports.registrationStore.readRow({
    projectId: run.projectId,
    runId,
    resultKind: "run-state",
    resultId: runStateArtifactId,
    resultVersionId: runState.runVersionId,
  });
  if (priorRunState?.artifactRef !== undefined) {
    artifactRefs.set(runStateArtifactId, priorRunState.artifactRef);
  } else {
    await put(runStateArtifactId, { bodyKind: "run-state", runState });
  }
  if (input.runResult !== undefined) {
    await put(runResultArtifactId, { bodyKind: "run-result", runResult: input.runResult });
  }
  const runStateArtifactRef = artifactRefs.get(runStateArtifactId);
  const runResultArtifactRef = artifactRefs.get(runResultArtifactId);
  if (runStateArtifactRef === undefined) {
    throw new TypeError("risk-flow graph advance is missing the run-state body reference");
  }
  const base = {
    schemaVersion: "1" as const,
    projectId: run.projectId,
    runId,
    runVersionId: runState.runVersionId,
    threadId: run.threadId,
    entryMode: run.entryMode,
    commandId: actionId,
    actorRef: run.actorId,
    authorizationContextRef: run.authorization.authorizationContextRef,
    authorizationScopeDigest: authorizationScopeDigest(run.authorization),
    validAt: run.validAt,
    // 记录/持久化时点取本次动作时刻：正文自身的内容时间仍取本运行首次记录时间（内容寻址），
    // 但回读“最新运行状态”必须按真实持久化顺序，不能所有行共享同一时间戳。
    recordedAt: occurredAt,
    persistedAt: occurredAt,
    auditEntryId,
    frozenRefs: [...run.frozenRefs],
  };
  const rows: WorkflowGraphResultRowV1[] = [];
  for (const entrySnapshot of input.entrySnapshots ?? []) {
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "entry-snapshot",
        // 入口快照行按运行身份限定：入口身份（工程+入口+冻结引用）相同的两个运行不得互相吞掉
        // 对方的入口快照事实，否则后一个运行读不到自己的配对/准备引用（design D-01/D-08）。
        resultId: `risk-flow-graph-entry-snapshot:${runId}:${entrySnapshot.entryIdentity.versionId}`,
        resultVersionId: entrySnapshot.entryIdentity.versionId,
        idempotencyKey: `risk-flow-graph:entry-snapshot:${runId}:${entrySnapshot.entryIdentity.versionId}`,
        requestDigest: sha256CanonicalJson({
          resultKind: "entry-snapshot",
          entryIdentity: entrySnapshot.entryIdentity,
          frozenRefs: entrySnapshot.frozenRefs.map(refKeyOf).sort(),
        }),
        stage: input.stage,
        entryIdentity: entrySnapshot.entryIdentity,
        frozenRefs: [...entrySnapshot.frozenRefs],
      }),
    );
  }
  for (const stageResultRef of input.stageResults ?? []) {
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "stage-result",
        resultId: stageResultRef.reference.entityId,
        resultVersionId: stageResultRef.reference.versionId,
        idempotencyKey: `risk-flow-graph:stage-result:${runId}:${suffix}:${stageResultRef.reference.versionId}`,
        requestDigest: sha256CanonicalJson({ resultKind: "stage-result", stageResultRef }),
        stage: input.stage,
        stageResultRef,
      }),
    );
  }
  for (const route of input.routeDecisions ?? []) {
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "route-decision",
        resultId: route.ref.reference.entityId,
        resultVersionId: route.ref.reference.versionId,
        idempotencyKey: `risk-flow-graph:route-decision:${runId}:${suffix}:${route.routeKind}:${sha256CanonicalJson(route.ref).slice(0, 24)}`,
        requestDigest: sha256CanonicalJson({ resultKind: "route-decision", route }),
        routeDecisionRef: route.ref,
        routeKind: route.routeKind,
      }),
    );
  }
  for (const waiting of waitings) {
    const key = waitingKey(waiting);
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "waiting",
        resultId: `risk-flow-waiting:${runId}:${key.slice(0, 32)}`,
        resultVersionId: key,
        idempotencyKey: `risk-flow-graph:waiting:${runId}:${key}`,
        requestDigest: sha256CanonicalJson({ resultKind: "waiting", waiting }),
        stage: input.stage,
        waitingRef: waiting,
      }),
    );
  }
  if (input.workflowErrorRef !== undefined) {
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "workflow-error",
        resultId: input.workflowErrorRef.reference.entityId,
        resultVersionId: input.workflowErrorRef.reference.versionId,
        idempotencyKey: `risk-flow-graph:workflow-error:${runId}:${suffix}:${input.workflowErrorRef.reference.versionId}`,
        requestDigest: sha256CanonicalJson({
          resultKind: "workflow-error",
          workflowErrorRef: input.workflowErrorRef,
        }),
        stage: input.stage,
        workflowErrorRef: input.workflowErrorRef,
      }),
    );
  }
  if (runResultArtifactRef !== undefined) {
    rows.push(
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "run-result",
        resultId: runResultArtifactRef.reference.entityId,
        resultVersionId: runResultArtifactRef.reference.versionId,
        idempotencyKey: `risk-flow-graph:run-result:${runId}:${suffix}`,
        requestDigest: sha256CanonicalJson({ resultKind: "run-result", runResultArtifactRef }),
        stage: input.stage,
        runResultRef: runResultArtifactRef,
        // 正文只有 C04 工件引用能定位（`run-result` 与 `content-artifact` 是不同引用种类）。
        artifactRef: runResultArtifactRef,
      }),
    );
  }
  rows.push(
    WorkflowGraphResultRowV1Schema.parse({
      ...base,
      resultKind: "run-state",
      resultId: runStateArtifactRef.reference.entityId,
      // run-state 行的版本就是运行状态版本（核心判别与数据库 CHECK 一致），否则回读无法定位正文。
      resultVersionId: runState.runVersionId,
      artifactRef: runStateArtifactRef,
      idempotencyKey: `risk-flow-graph:run-state:${runState.runVersionId}`,
      requestDigest: sha256CanonicalJson({ resultKind: "run-state", runStateArtifactRef }),
      stage: input.nextStage,
    }),
  );
  const links = input.links ?? [];
  await ports.transactionUnit.execute(
    {
      projectId: run.projectId,
      commandKind: input.commandKind,
      commandId: actionId,
      idempotencyKey: actionId,
      payload: {
        actionSuffix: suffix,
        runVersionId: runState.runVersionId,
        rows: rows.length,
        links: links.length,
      } satisfies Record<string, JsonValue>,
      actorRef: run.actorId,
      authorizationContextRef: run.authorization.authorizationContextRef,
      issuedAt: run.entryRecordedAt,
      runId,
      threadId: run.threadId,
    },
    async (context: TransactionContextV1) => {
      try {
        await ports.registrationStore.assertCurrentRunVersion(
          { projectId: run.projectId, runId, expectedRunVersionId: input.cursor?.runVersionId },
          context,
        );
      } catch {
        // 运行级版本不符：同键并发或已提交的同动作，交由运行层按版本冲突收口，不覆盖事实。
        throw new RiskFlowGraphConflictV1(`run-version:${runId}`);
      }
      for (const row of rows) {
        const outcome = await ports.registrationStore.registerRow(
          { row, occurredAt: run.entryRecordedAt },
          context,
        );
        if (outcome.kind === "idempotency-conflict") {
          throw new RiskFlowGraphConflictV1(outcome.priorCommandId);
        }
      }
      for (const link of links) {
        await ports.registrationStore.registerLink(
          {
            link: {
              schemaVersion: "1",
              projectId: run.projectId,
              linkId: linkIdFor({
                runId,
                fromRef: link.fromRef,
                toRef: link.toRef,
                relation: link.relation,
              }),
              runId,
              fromRef: link.fromRef,
              toRef: link.toRef,
              relation: link.relation,
              sourceStage: link.sourceStage,
              ...(link.stageResultRef === undefined ? {} : { stageResultRef: link.stageResultRef }),
              authorizationContextRef: run.authorization.authorizationContextRef,
              authorizationScopeDigest: authorizationScopeDigest(run.authorization),
              actorRef: run.actorId,
              recordedAt: run.entryRecordedAt,
              auditEntryId,
            },
          },
          context,
        );
      }
      return {
        resultRef: runStateArtifactRef as ContractReferenceV1,
        audit: {
          auditEntryId,
          projectId: run.projectId,
          action: input.commandKind,
          targetRef: runStateArtifactRef as ContractReferenceV1,
          actorRef: run.actorId,
          authorizationContextRef: run.authorization.authorizationContextRef,
          occurredAt,
          recordedAt: occurredAt,
          version: {
            entityId: runStateArtifactRef.reference.entityId,
            versionId: runStateArtifactRef.reference.versionId,
          },
          commandId: actionId,
          idempotencyKey: actionId,
          runId,
          threadId: run.threadId,
        },
        events: [],
      };
    },
  );
  return graphStateOf(run, runState);
};

/** 逐风险评估子运行计划：父图只登记引用，子运行自身由注入的评估运行时执行（design D-02）。 */
interface AssessmentSubRunPlanV1 {
  readonly riskRecordRef: ContractReferenceV1;
  readonly pairing: RiskFlowAssessmentPairingV1;
  readonly runRef: WorkflowRunRefV1;
}

/** 子运行同步结果：本动作要登记的路由行、链边与已成立子运行集合。 */
interface SubRunSyncV1 {
  readonly started: readonly AssessmentSubRunPlanV1[];
  readonly blocked: readonly StandardizedRiskRecordRefV1[];
  readonly acceptedRefs: StandardizedRiskRecordRefV1[];
  readonly routeDecisions: readonly {
    readonly ref: RouteDecisionRefV1;
    readonly routeKind: string;
  }[];
  readonly links: readonly LinkV1[];
}

const sameSpatialScope = (left: SpatialScopeRefV1, right: SpatialScopeRefV1): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

/**
 * 按精确风险版本幂等建立评估子运行（design D-02）：
 * - 每条已验收风险版本恰一个子运行身份（`assessmentSubRunIdentityFor`），重复事件只回查既有路由行；
 * - 每条风险只使用**它自己空间**的配对上下文，缺配对或错误复用别的空间时阻断该风险；
 * - 子运行启动命令身份由父运行与风险引用派生，崩溃后重放命中同一子运行，不产生第二个事实。
 */
const syncAssessmentSubRuns = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly rows: readonly WorkflowGraphResultRowV1[];
  readonly identificationRunRef: WorkflowRunRefV1 | undefined;
  readonly acceptedRefs: readonly StandardizedRiskRecordRefV1[];
}): Promise<SubRunSyncV1> => {
  const { ports, run } = input;
  const runId = run.runRef.reference.entityId;
  const established = assessmentSubRunRouteIdsV1(input.rows);
  const acceptedRefs = dedupeByKey(input.acceptedRefs);
  const started: AssessmentSubRunPlanV1[] = [];
  const blocked: StandardizedRiskRecordRefV1[] = [];
  const routeDecisions: { ref: RouteDecisionRefV1; routeKind: string }[] = [];
  const links: LinkV1[] = [];
  for (const riskRecordRef of acceptedRefs) {
    const routeId = assessmentSubRunRouteIdFor({ runId, riskRecordRef });
    if (established.has(routeId)) continue;
    const space = await ports.riskSpatialPairing.resolve({
      projectId: run.projectId,
      riskRecordRef,
      identificationRunRef: input.identificationRunRef,
      pairings: run.pairing,
      actorId: run.actorId,
      requestedAt: run.entryRecordedAt,
      authorization: run.authorization,
    });
    const pairing =
      space === undefined
        ? undefined
        : run.pairing.find((candidate) => sameSpatialScope(candidate.spatialScopeRef, space));
    if (pairing === undefined) {
      blocked.push(riskRecordRef);
      routeDecisions.push({
        ref: {
          kind: "route-decision",
          reference: {
            entityId: pairingBlockedRouteIdFor({ runId, riskRecordRef }),
            versionId: sha256CanonicalJson({
              riskRecordRef,
              reasonCode: RISK_FLOW_ROUTE_KIND_PAIRING_MISSING_V1,
            }),
          },
        },
        routeKind: RISK_FLOW_ROUTE_KIND_PAIRING_MISSING_V1,
      });
      continue;
    }
    const command = assessmentStartCommandFor({ run, riskRecordRef, pairing });
    const outcome = await ports.assessmentRuntime.start(command);
    if (
      outcome.runRef.reference.entityId !== command.runRef.reference.entityId ||
      outcome.runRef.reference.versionId !== command.runRef.reference.versionId
    ) {
      throw new RiskFlowGraphNodeFailureV1(
        contractInvalid({
          stage: "identification",
          detailCode: "assessment-sub-run-identity-mismatch",
          occurredAt: ports.now().toISOString(),
        }),
      );
    }
    started.push({ riskRecordRef, pairing, runRef: outcome.runRef });
    routeDecisions.push({
      ref: {
        kind: "route-decision",
        reference: {
          entityId: routeId,
          versionId: sha256CanonicalJson({ riskRecordRef, childRunRef: outcome.runRef }),
        },
      },
      routeKind: RISK_FLOW_ROUTE_KIND_SUB_RUN_V1,
    });
    links.push({
      fromRef: run.runRef,
      toRef: outcome.runRef,
      relation: "parent-child",
      sourceStage: "identification",
    });
  }
  return { started, blocked, acceptedRefs, routeDecisions, links };
};

/** 子运行汇总：只读子运行自己的运行状态，按状态收口等待/失败/完成（design D-02/D-08）。 */
interface SubRunAggregateV1 {
  readonly completedRunRefs: readonly WorkflowRunRefV1[];
  readonly waitings: readonly WaitingRefV1[];
  readonly retryableErrorRef?: WorkflowErrorRefV1;
  readonly terminalErrorRef?: WorkflowErrorRefV1;
  /** 至少一个子运行尚未登记可读状态或不处于稳定终态。 */
  readonly pending: boolean;
  /** 子运行状态证据：动作身份与汇总正文都由它确定性派生（design D-08）。 */
  readonly evidence: readonly (readonly [string, string, string])[];
  /** 子运行自己登记的缺席链尾：父运行只镜像类型化原因，不另造占位原因（design D-09）。 */
  readonly skippedTails: readonly WorkflowGraphRunResultV1["skippedTails"][number][];
  readonly refs: Pick<
    WorkflowGraphRunStateV1,
    | "assessmentRecordRefs"
    | "warningRecordRefs"
    | "responseRecommendationRefs"
    | "deviationRecordRefs"
    | "calibrationSuggestionRefs"
  >;
}

/** 领域引用汇总为空：失败终态只引用已成立事实，不补造任何领域引用（design D-08）。 */
const emptyAggregatedRefs: SubRunAggregateV1["refs"] = {
  assessmentRecordRefs: [],
  warningRecordRefs: [],
  responseRecommendationRefs: [],
  deviationRecordRefs: [],
  calibrationSuggestionRefs: [],
};

/** 缺席链尾去重：同一 (tailKind, 原因码, 最后成立引用) 只保留一条（design D-09）。 */
const dedupeSkippedTails = (
  tails: readonly WorkflowGraphRunResultV1["skippedTails"][number][],
): WorkflowGraphRunResultV1["skippedTails"][number][] => {
  const seen = new Set<string>();
  const result: WorkflowGraphRunResultV1["skippedTails"][number][] = [];
  for (const tail of tails) {
    const key = `${tail.tailKind}|${tail.reasonCode}|${
      tail.lastEstablishedRef === undefined ? "" : refKeyOf(tail.lastEstablishedRef)
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tail);
  }
  return result;
};

/**
 * 子运行自己登记的缺席链尾：父运行只镜像已登记的类型化原因，不另造占位原因（design D-09）。
 * 正文经 C04 工件引用读取（`run-result` 与 `content-artifact` 是不同引用种类）。
 */
const childSkippedTails = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly childRunRef: WorkflowRunRefV1;
}): Promise<readonly WorkflowGraphRunResultV1["skippedTails"][number][]> => {
  const rows = await input.ports.registrationStore.listRunRows({
    projectId: input.run.projectId,
    runId: input.childRunRef.reference.entityId,
  });
  const artifactRef = rows.find((row) => row.resultKind === "run-result")?.artifactRef;
  if (artifactRef === undefined) return [];
  const body = await input.ports.bodies.readBody({
    projectId: input.run.projectId,
    artifactRef,
    actorId: input.run.actorId,
    requestedAt: input.run.issuedAt,
    authorization: input.run.authorization,
  });
  return body?.bodyKind === "run-result" ? body.runResult.skippedTails : [];
};

const aggregateAssessmentSubRuns = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly childRunRefs: readonly WorkflowRunRefV1[];
}): Promise<SubRunAggregateV1> => {
  const { ports, run } = input;
  const completedRunRefs: WorkflowRunRefV1[] = [];
  const waitings: WaitingRefV1[] = [];
  const evidence: [string, string, string][] = [];
  const skippedTails: WorkflowGraphRunResultV1["skippedTails"][number][] = [];
  const refs: SubRunAggregateV1["refs"] = {
    assessmentRecordRefs: [],
    warningRecordRefs: [],
    responseRecommendationRefs: [],
    deviationRecordRefs: [],
    calibrationSuggestionRefs: [],
  };
  let retryableErrorRef: WorkflowErrorRefV1 | undefined;
  let terminalErrorRef: WorkflowErrorRefV1 | undefined;
  let pending = false;
  for (const childRunRef of input.childRunRefs) {
    const latest = await ports.registrationStore.readLatestRunState({
      projectId: run.projectId,
      runId: childRunRef.reference.entityId,
      actorId: run.actorId,
      requestedAt: run.issuedAt,
      authorization: run.authorization,
    });
    if (latest === undefined) {
      pending = true;
      evidence.push([refKeyOf(childRunRef), "unregistered", ""]);
      continue;
    }
    const state = latest.state;
    evidence.push([refKeyOf(childRunRef), state.status, latest.row.runVersionId]);
    switch (state.status) {
      case "completed":
        completedRunRefs.push(childRunRef);
        skippedTails.push(...(await childSkippedTails({ ports, run, childRunRef })));
        refs.assessmentRecordRefs.push(...state.assessmentRecordRefs);
        refs.warningRecordRefs.push(...state.warningRecordRefs);
        refs.responseRecommendationRefs.push(...state.responseRecommendationRefs);
        refs.deviationRecordRefs.push(...state.deviationRecordRefs);
        refs.calibrationSuggestionRefs.push(...state.calibrationSuggestionRefs);
        break;
      case "waiting":
        if (state.lastWaitingRef === undefined) {
          pending = true;
          break;
        }
        waitings.push(state.lastWaitingRef);
        break;
      case "retryable-failure":
        retryableErrorRef ??= state.lastErrorRef;
        break;
      case "terminal-failure":
        terminalErrorRef ??= state.lastErrorRef;
        break;
      default:
        pending = true;
        break;
    }
  }
  return {
    completedRunRefs,
    waitings: dedupeWaitings(waitings),
    pending,
    evidence,
    skippedTails: dedupeSkippedTails(skippedTails),
    refs: {
      assessmentRecordRefs: dedupeByKey(refs.assessmentRecordRefs),
      warningRecordRefs: dedupeByKey(refs.warningRecordRefs),
      responseRecommendationRefs: dedupeByKey(refs.responseRecommendationRefs),
      deviationRecordRefs: dedupeByKey(refs.deviationRecordRefs),
      calibrationSuggestionRefs: dedupeByKey(refs.calibrationSuggestionRefs),
    },
    ...(retryableErrorRef === undefined ? {} : { retryableErrorRef }),
    ...(terminalErrorRef === undefined ? {} : { terminalErrorRef }),
  };
};

/** 冻结重试预算：只来自冻结 `retryPolicyRef`；读不到时按一次尝试收口，绝不猜测阈值。 */
const retryBudget = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
}): Promise<number> => {
  try {
    const policy = await input.ports.retryPolicy.read({
      projectId: input.run.projectId,
      retryPolicyRef: input.run.retryPolicyRef,
      requestedAt: input.run.issuedAt,
      authorization: input.run.authorization,
    });
    return policy?.maxAttempts ?? 1;
  } catch {
    return 1;
  }
};

/** 同一阶段同一原因的历史失败次数：动作身份不变，attempt 单调增加（design D-05/D-08）。 */
const failureAttempts = async (input: {
  readonly rows: readonly WorkflowGraphResultRowV1[];
  readonly stage: RiskFlowStageV1;
  readonly detailCode: string;
}): Promise<number> =>
  input.rows.filter(
    (row) =>
      row.resultKind === "workflow-error" &&
      row.workflowErrorRef?.reference.entityId.startsWith(
        `risk-flow-graph-workflow-error:${input.stage}:${input.detailCode}`,
      ) === true,
  ).length;

/** 错误引用身份：由阶段、原因与尝试序号确定性派生，重放得到同一错误事实。 */
const workflowErrorRefFor = (input: {
  readonly stage: RiskFlowStageV1;
  readonly error: WorkflowGraphErrorV1;
  readonly attempt: number;
}): WorkflowErrorRefV1 => ({
  kind: "workflow-error",
  reference: {
    entityId: `risk-flow-graph-workflow-error:${input.stage}:${input.error.detailCode}`,
    versionId: sha256CanonicalJson({ error: input.error, attempt: input.attempt }),
  },
});

/** 运行汇总正文（design D-05）：只汇总精确引用与缺席原因，不复制领域正文。 */
const runResultFor = (input: {
  readonly run: RiskFlowGraphRunContextV1;
  readonly identificationRunRef?: WorkflowRunRefV1;
  readonly assessmentRunRefs: readonly WorkflowRunRefV1[];
  readonly acceptedRiskRecordRefs: readonly ContractReferenceV1[];
  readonly refs: SubRunAggregateV1["refs"];
  readonly skippedTails: readonly WorkflowGraphRunResultV1["skippedTails"][number][];
}): WorkflowGraphRunResultV1 => {
  const runId = input.run.runRef.reference.entityId;
  const evidence = sha256CanonicalJson({
    runRef: input.run.runRef,
    entryMode: input.run.entryMode,
    assessmentRunRefs: input.assessmentRunRefs,
    acceptedRiskRecordRefs: input.acceptedRiskRecordRefs.map(refKeyOf).sort(),
    skippedTails: input.skippedTails,
  });
  return {
    schemaVersion: "1",
    projectId: input.run.projectId,
    runRef: input.run.runRef,
    entryMode: input.run.entryMode,
    stage: "result-summary",
    ...(input.identificationRunRef === undefined
      ? {}
      : { identificationRunRef: input.identificationRunRef }),
    assessmentRunRefs: [...input.assessmentRunRefs],
    assessmentRecordRefs: [...input.refs.assessmentRecordRefs],
    warningRecordRefs: [...input.refs.warningRecordRefs],
    responseRecommendationRefs: [...input.refs.responseRecommendationRefs],
    deviationRecordRefs: [...input.refs.deviationRecordRefs],
    calibrationSuggestionRefs: [...input.refs.calibrationSuggestionRefs],
    skippedTails: [...input.skippedTails],
    auditTrailRef: {
      kind: "audit-trail",
      reference: { entityId: `risk-flow-run-audit:${runId}`, versionId: evidence },
    },
    recordedAt: input.run.entryRecordedAt,
  };
};

/**
 * 运行汇总引用：公共图状态的 `resultRef` 只接受 `risk-flow-run-result` 类型，因此终态必须引用
 * 本次汇总自身的稳定身份（与汇总正文的证据摘要同源），绝不指向工作流运行引用（design D-05）。
 */
const runResultRefFor = (input: {
  readonly run: RiskFlowGraphRunContextV1;
  readonly runResult: WorkflowGraphRunResultV1;
}): RiskFlowRunResultRefV1 => ({
  kind: "risk-flow-run-result",
  reference: {
    entityId: `risk-flow-run-result:${input.run.runRef.reference.entityId}`,
    versionId: input.runResult.auditTrailRef.reference.versionId,
  },
});

/** 运行级失败收口：登记错误行与新状态，按状态收口到可重试或终止（design D-08）。 */
const recordNodeFailure = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly cursor: WorkflowGraphRunStateV1 | undefined;
  readonly rows: readonly WorkflowGraphResultRowV1[];
  readonly stage: RiskFlowStageV1;
  readonly error: unknown;
}): Promise<RiskFlowGraphStateV1> => {
  const occurredAt = input.ports.now().toISOString();
  const error = toRiskFlowGraphError({ stage: input.stage, error: input.error, occurredAt });
  const attempts = await failureAttempts({
    rows: input.rows,
    stage: input.stage,
    detailCode: error.detailCode,
  });
  const budget = await retryBudget({ ports: input.ports, run: input.run });
  const retryable = error.retryable && attempts < budget;
  const stableError = WorkflowGraphErrorV1Schema.parse({ ...error, retryable });
  const workflowErrorRef = workflowErrorRefFor({
    stage: input.stage,
    error: stableError,
    attempt: attempts + 1,
  });
  const status: WorkflowRunStatusV1 = retryable ? "retryable-failure" : "terminal-failure";
  const suffix = `${input.stage}:failure:${error.detailCode}:attempt-${attempts + 1}`;
  const nextStage: RiskFlowStageV1 = retryable ? input.stage : "result-summary";
  const runResult =
    retryable || input.cursor === undefined
      ? undefined
      : runResultFor({
          run: input.run,
          ...(input.cursor.identificationRunRef === undefined
            ? {}
            : { identificationRunRef: input.cursor.identificationRunRef }),
          assessmentRunRefs: input.cursor.assessmentRunRefs,
          acceptedRiskRecordRefs: input.cursor.acceptedRiskRecordRefs,
          refs: emptyAggregatedRefs,
          skippedTails: [
            {
              tailKind: "warning",
              reasonCode: error.detailCode,
              ...(input.cursor.identificationRunRef === undefined
                ? {}
                : { lastEstablishedRef: input.cursor.identificationRunRef }),
            },
          ],
        });
  return await advance({
    ports: input.ports,
    run: input.run,
    cursor: input.cursor,
    stage: input.stage,
    nextStage,
    status,
    actionSuffix: suffix,
    commandKind: "risk-flow-graph.failure",
    workflowErrorRef,
    ...(runResult === undefined ? {} : { runResult }),
    statePatch: { lastErrorRef: workflowErrorRef },
  });
};

/** 识别子图状态 → 父运行等待引用：只投影已成立的等待与待复核任务，不伪造等待种类。 */
const identificationWaitings = (input: {
  readonly waitingRef?: IdentificationGraphStateV1["waitingRef"];
  readonly reviewTaskRefs: IdentificationGraphStateV1["reviewTaskRefs"];
}): readonly WaitingRefV1[] =>
  dedupeWaitings([
    ...(input.waitingRef === undefined ? [] : [input.waitingRef]),
    ...input.reviewTaskRefs.map((reviewTaskRef): WaitingRefV1 => ({
      kind: "review",
      reviewTaskRef,
    })),
  ]);

/** 节点处理面：只接收注入端口、运行身份与当前公开状态。 */
type StageHandlerV1 = (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly state: RiskFlowGraphStateV1;
}) => Promise<RiskFlowGraphStateV1>;

/** 逐空间入口快照：每份冻结输入只含本空间的空间/适用性/监测引用（design D-01）。 */
const entrySnapshotsFor = (
  run: RiskFlowGraphRunContextV1,
): readonly {
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
}[] =>
  run.pairing.map((pairing) => {
    const frozenRefs = pairingFrozenRefsV1({ frozenRefs: run.frozenRefs, pairing });
    return {
      entryIdentity: workflowEntryIdentityFor({
        entryMode: run.entryMode,
        projectId: run.projectId,
        frozenRefs,
      }),
      frozenRefs,
    };
  });

/** `preparing`：登记逐空间入口快照与入口路由，再进入识别阶段（design D-01/D-05）。 */
const stagePrepare: StageHandlerV1 = async ({ ports, run }) => {
  const cursor = await readRiskFlowCursor({ ports, run });
  const runId = run.runRef.reference.entityId;
  const entryRouteRef: ContractReferenceV1 = {
    kind: "route-decision",
    reference: {
      entityId: `risk-flow-entry:${runId}`,
      versionId: sha256CanonicalJson({
        entryMode: run.entryMode,
        entryIdentity: run.entryIdentity,
        frozenRefs: run.frozenRefs.map(refKeyOf).sort(),
      }),
    },
  };
  const preparingStageResult = stageResultRefFor({
    runId,
    stage: "preparing",
    evidence: { entryRouteRef },
  });
  // 人工决定等待门（design D2）：人工采纳事实成立前只登记真实父运行、入口路由、阶段结果与等待行，
  // 不启动评估子图、不产生任何预测；等待引用自带精确建议与已授权空间，恢复时按它逐项复核。
  if (run.humanDecisionGate !== undefined) {
    const waiting: Extract<WaitingRefV1, { readonly kind: "human-decision" }> = {
      kind: "human-decision",
      routeDecisionRef: entryRouteRef,
      responseRecommendationRef: run.humanDecisionGate.responseRecommendationRef,
      spatialScopeRef: run.humanDecisionGate.spatialScopeRef,
    };
    return await advance({
      ports,
      run,
      cursor,
      stage: "preparing",
      // 游标阶段与正常路径一致地指向“下一个要执行的阶段”：恢复后直接进入评估节点，
      // 不重跑 `preparing`（同一运行动作身份不可携带不同载荷重复登记，design D-05/D-08）。
      nextStage: "assessment",
      status: "waiting",
      actionSuffix: "prepare",
      commandKind: "risk-flow-graph.prepare",
      entrySnapshots: entrySnapshotsFor(run),
      routeDecisions: [{ ref: entryRouteRef, routeKind: RISK_FLOW_ROUTE_KIND_ENTRY_ACCEPTED_V1 }],
      stageResults: [preparingStageResult],
      waitings: [waiting],
      statePatch: { lastRouteDecisionRef: entryRouteRef, lastStageResultRef: preparingStageResult },
    });
  }
  return await advance({
    ports,
    run,
    cursor,
    stage: "preparing",
    // 只有识别入口存在识别阶段；其它有限入口直接进入唯一评估子运行（design D-02/D-04）。
    nextStage: run.entryMode === "identify-and-assess" ? "identification" : "assessment",
    status: "running",
    actionSuffix: "prepare",
    commandKind: "risk-flow-graph.prepare",
    entrySnapshots: entrySnapshotsFor(run),
    routeDecisions: [{ ref: entryRouteRef, routeKind: RISK_FLOW_ROUTE_KIND_ENTRY_ACCEPTED_V1 }],
    stageResults: [preparingStageResult],
    links: [
      {
        fromRef: run.runRef,
        toRef: preparingStageResult,
        relation: "run-stage",
        sourceStage: "preparing",
        stageResultRef: preparingStageResult,
      },
    ],
    statePatch: { lastRouteDecisionRef: entryRouteRef, lastStageResultRef: preparingStageResult },
  });
};

/**
 * `identification`：先把真实父运行引用与 C11 准备快照交给 C24，再按每条已验收风险记录的精确版本
 * 建立独立评估子运行；待复核组只登记等待，不阻断已验收风险（design D-02）。
 */
const stageIdentification: StageHandlerV1 = async ({ ports, run }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readRiskFlowCursor({ ports, run });
  const rows = await readRiskFlowRows({ ports, run });
  const runId = run.runRef.reference.entityId;
  const preparation =
    run.identificationPreparationSnapshotRef ?? identificationPreparationFromRowsV1(rows);
  if (preparation === undefined) {
    // 正式评估准备未到达：只登记类型化等待，零评估事实（design D-01/D-02）。
    const waiting = identificationPreparationWaitingFor({ runRef: run.runRef });
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "identification",
      status: "waiting",
      actionSuffix: "identification:preparation-waiting",
      commandKind: "risk-flow-graph.wait",
      waitings: [waiting],
      statePatch: {},
    });
  }
  if (identificationPreparationFromRowsV1(rows) === undefined) {
    // 首次收到准备引用：先按入口快照登记，恢复时不再依赖单次 resume 载荷（design D-02/D-08）。
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "identification",
      status: "running",
      actionSuffix: `identification:preparation:${sha256CanonicalJson(preparation).slice(0, 32)}`,
      commandKind: "risk-flow-graph.identification-preparation",
      entrySnapshots: [
        {
          entryIdentity: workflowEntryIdentityFor({
            entryMode: run.entryMode,
            projectId: run.projectId,
            frozenRefs: [preparation],
          }),
          frozenRefs: [preparation],
        },
      ],
      statePatch: {},
    });
  }
  const outcome = await ports.identificationRuntime.start(
    identificationStartCommandFor({ run, preparationSnapshotRef: preparation }),
  );
  const childState = outcome.state;
  const childRunRef = childState.runRef;
  const identificationStageResult = stageResultRefFor({
    runId,
    stage: "identification",
    evidence: { identificationRunRef: childRunRef },
  });
  const acceptedRefs = dedupeByKey([
    ...(cursor?.acceptedRiskRecordRefs ?? []),
    ...acceptedRiskRefsFromRowsV1(rows),
    ...childState.acceptedRiskRecordRefs,
  ]);
  const sync = await syncAssessmentSubRuns({
    ports,
    run,
    rows,
    identificationRunRef: childRunRef,
    acceptedRefs,
  });
  const assessmentRunRefs = dedupeRunRefs([
    ...(cursor?.assessmentRunRefs ?? []),
    ...sync.started.map((plan) => plan.runRef),
  ]);
  const waitings = identificationWaitings({
    ...(childState.waitingRef === undefined ? {} : { waitingRef: childState.waitingRef }),
    reviewTaskRefs: childState.reviewTaskRefs,
  });
  const actionSuffix = `identification:${sha256CanonicalJson({
    childRunRef,
    childRunVersionId: outcome.runVersionId,
    childStatus: childState.status,
    acceptedRefs: acceptedRefs.map(refKeyOf).sort(),
    startedSubRuns: sync.started.map((plan) => refKeyOf(plan.runRef)),
    blocked: sync.blocked.map(refKeyOf).sort(),
  }).slice(0, 32)}`;
  const statePatch = {
    identificationRunRef: childRunRef,
    acceptedRiskRecordRefs: sync.acceptedRefs,
    assessmentRunRefs,
    lastStageResultRef: identificationStageResult,
  };
  const links: LinkV1[] = [
    {
      fromRef: run.runRef,
      toRef: childRunRef,
      relation: "parent-child",
      sourceStage: "identification",
    },
    {
      fromRef: run.runRef,
      toRef: identificationStageResult,
      relation: "run-stage",
      sourceStage: "identification",
      stageResultRef: identificationStageResult,
    },
    ...sync.links,
  ];
  if (sync.blocked.length > 0) {
    // 缺少本风险空间配对：阻断该风险的评估并按正式失败收口，仍保留其它风险已成立的事实。
    const errorRef = workflowErrorRefFor({
      stage: "identification",
      error: riskFlowGraphError({
        code: "ENTRY_REFERENCES_INCOMPLETE",
        stage: "identification",
        detailCode: RISK_FLOW_ROUTE_KIND_PAIRING_MISSING_V1,
        occurredAt,
      }),
      attempt: 1,
    });
    const runResult = runResultFor({
      run,
      identificationRunRef: childRunRef,
      assessmentRunRefs,
      acceptedRiskRecordRefs: sync.acceptedRefs,
      refs: emptyAggregatedRefs,
      skippedTails: sync.blocked.map((riskRecordRef) => ({
        tailKind: "warning" as const,
        reasonCode: RISK_FLOW_ROUTE_KIND_PAIRING_MISSING_V1,
        lastEstablishedRef: riskRecordRef,
      })),
    });
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "result-summary",
      status: "terminal-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.identification",
      stageResults: [identificationStageResult],
      routeDecisions: sync.routeDecisions,
      waitings,
      workflowErrorRef: errorRef,
      runResult,
      links,
      // 运行汇总只作为登记事实（run-result 行）保留：终态失败的公共状态不得携带汇总引用。
      statePatch: { ...statePatch, lastErrorRef: errorRef },
    });
  }
  if (childState.status === "terminal-failure" || childState.status === "cancelled") {
    const errorRef = workflowErrorRefFor({
      stage: "identification",
      error: riskFlowGraphError({
        code: childState.status === "cancelled" ? "CANCELLED" : "CONTRACT_INVALID",
        stage: "identification",
        detailCode: `identification-run-${childState.status}`,
        occurredAt,
      }),
      attempt: 1,
    });
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "result-summary",
      status: "terminal-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.identification",
      stageResults: [identificationStageResult],
      routeDecisions: sync.routeDecisions,
      workflowErrorRef: errorRef,
      links,
      statePatch: { ...statePatch, lastErrorRef: errorRef },
    });
  }
  if (childState.status === "retryable-failure") {
    const errorRef =
      childState.lastErrorRef ??
      workflowErrorRefFor({
        stage: "identification",
        error: riskFlowGraphError({
          code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
          stage: "identification",
          detailCode: "identification-run-retryable-failure",
          occurredAt,
          retryable: true,
        }),
        attempt: 1,
      });
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "identification",
      status: "retryable-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.identification",
      stageResults: [identificationStageResult],
      routeDecisions: sync.routeDecisions,
      links,
      statePatch: { ...statePatch, lastErrorRef: errorRef },
    });
  }
  if (waitings.length > 0) {
    // 待复核组保留为等待引用；已验收风险的评估子运行本轮照常推进（design D-02）。
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "identification",
      status: "waiting",
      actionSuffix,
      commandKind: "risk-flow-graph.identification",
      stageResults: [identificationStageResult],
      routeDecisions: sync.routeDecisions,
      waitings,
      links,
      statePatch,
    });
  }
  if (sync.acceptedRefs.length === 0) {
    // 无合格风险：如实登记原因码并形成终态汇总，绝不创建空评估（design D-02）。
    const routeRef: ContractReferenceV1 = {
      kind: "route-decision",
      reference: {
        entityId: `risk-flow-no-qualified-risk:${runId}`,
        versionId: sha256CanonicalJson({
          identificationRunRef: childRunRef,
          identificationRunVersionId: outcome.runVersionId,
        }),
      },
    };
    return await advance({
      ports,
      run,
      cursor,
      stage: "identification",
      nextStage: "result-summary",
      status: "running",
      actionSuffix,
      commandKind: "risk-flow-graph.identification",
      stageResults: [identificationStageResult],
      routeDecisions: [{ ref: routeRef, routeKind: RISK_FLOW_ROUTE_KIND_NO_QUALIFIED_RISK_V1 }],
      links,
      statePatch: { ...statePatch, lastRouteDecisionRef: routeRef },
    });
  }
  return await advance({
    ports,
    run,
    cursor,
    stage: "identification",
    nextStage: "assessment",
    status: "running",
    actionSuffix,
    commandKind: "risk-flow-graph.identification",
    stageResults: [identificationStageResult],
    routeDecisions: sync.routeDecisions,
    links,
    statePatch,
  });
};

/**
 * `assessment`：只读每个评估子运行自己的运行状态，按其状态收口等待/失败/汇总；
 * 子运行未稳定时以受冻结预算约束的可重试失败收口，绝不猜测结论（design D-02/D-08）。
 */
const stageAssessment: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readRiskFlowCursor({ ports, run });
  const registeredChildRunRefs = dedupeRunRefs([
    ...state.assessmentRunRefs,
    ...(cursor?.assessmentRunRefs ?? []),
  ]);
  // 分段入口没有识别阶段：先幂等建立唯一评估子运行并登记路由，下一轮才按子运行状态汇总
  // （design D-02/D-04）。重复事件与恢复只会命中同一身份，不产生第二个子运行。
  if (run.entryMode !== "identify-and-assess" && registeredChildRunRefs.length === 0) {
    const command = segmentedAssessmentStartCommandFor({ run });
    const outcome = await ports.assessmentRuntime.start(command);
    if (
      outcome.runRef.reference.entityId !== command.runRef.reference.entityId ||
      outcome.runRef.reference.versionId !== command.runRef.reference.versionId
    ) {
      throw new RiskFlowGraphNodeFailureV1(
        contractInvalid({
          stage: "assessment",
          detailCode: "assessment-sub-run-identity-mismatch",
          occurredAt,
        }),
      );
    }
    const childRunRef = outcome.runRef;
    const routeRef: RouteDecisionRefV1 = {
      kind: "route-decision",
      reference: {
        entityId: segmentedSubRunRouteIdFor(run.runRef.reference.entityId),
        versionId: sha256CanonicalJson({ childRunRef }),
      },
    };
    return await advance({
      ports,
      run,
      cursor,
      stage: "assessment",
      nextStage: "assessment",
      status: "running",
      actionSuffix: `assessment:sub-run:${sha256CanonicalJson({ childRunRef }).slice(0, 32)}`,
      commandKind: "risk-flow-graph.assessment-sub-run",
      routeDecisions: [{ ref: routeRef, routeKind: RISK_FLOW_ROUTE_KIND_SUB_RUN_V1 }],
      links: [
        {
          fromRef: run.runRef,
          toRef: childRunRef,
          relation: "parent-child",
          sourceStage: "assessment",
        },
      ],
      statePatch: { assessmentRunRefs: [childRunRef], lastRouteDecisionRef: routeRef },
    });
  }
  const childRunRefs = registeredChildRunRefs;
  const aggregate = await aggregateAssessmentSubRuns({ ports, run, childRunRefs });
  const actionSuffix = `assessment:${sha256CanonicalJson({
    children: childRunRefs.map(refKeyOf),
    evidence: aggregate.evidence,
  }).slice(0, 32)}`;
  const statePatch = {
    acceptedRiskRecordRefs: cursor?.acceptedRiskRecordRefs ?? [],
    assessmentRunRefs: childRunRefs,
    ...aggregate.refs,
  };
  if (aggregate.terminalErrorRef !== undefined) {
    return await advance({
      ports,
      run,
      cursor,
      stage: "assessment",
      nextStage: "result-summary",
      status: "terminal-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.assessment",
      workflowErrorRef: aggregate.terminalErrorRef,
      links: [],
      statePatch: { ...statePatch, lastErrorRef: aggregate.terminalErrorRef },
    });
  }
  if (aggregate.retryableErrorRef !== undefined) {
    return await advance({
      ports,
      run,
      cursor,
      stage: "assessment",
      nextStage: "assessment",
      status: "retryable-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.assessment",
      workflowErrorRef: aggregate.retryableErrorRef,
      links: [],
      statePatch: { ...statePatch, lastErrorRef: aggregate.retryableErrorRef },
    });
  }
  if (aggregate.waitings.length > 0) {
    return await advance({
      ports,
      run,
      cursor,
      stage: "assessment",
      nextStage: "assessment",
      status: "waiting",
      actionSuffix,
      commandKind: "risk-flow-graph.assessment",
      waitings: aggregate.waitings,
      links: [],
      statePatch,
    });
  }
  if (aggregate.pending || aggregate.completedRunRefs.length !== childRunRefs.length) {
    const errorRef = workflowErrorRefFor({
      stage: "assessment",
      error: riskFlowGraphError({
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        stage: "assessment",
        detailCode: "assessment-sub-run-pending",
        occurredAt,
        retryable: true,
      }),
      attempt: 1,
    });
    return await advance({
      ports,
      run,
      cursor,
      stage: "assessment",
      nextStage: "assessment",
      status: "retryable-failure",
      actionSuffix,
      commandKind: "risk-flow-graph.assessment",
      workflowErrorRef: errorRef,
      links: [],
      statePatch: { ...statePatch, lastErrorRef: errorRef },
    });
  }
  const assessmentStageResult = stageResultRefFor({
    runId: run.runRef.reference.entityId,
    stage: "assessment",
    evidence: { children: aggregate.evidence },
  });
  return await advance({
    ports,
    run,
    cursor,
    stage: "assessment",
    nextStage: "result-summary",
    status: "running",
    actionSuffix,
    commandKind: "risk-flow-graph.assessment",
    stageResults: [assessmentStageResult],
    links: [
      {
        fromRef: run.runRef,
        toRef: assessmentStageResult,
        relation: "run-stage",
        sourceStage: "assessment",
        stageResultRef: assessmentStageResult,
      },
    ],
    statePatch: { ...statePatch, lastStageResultRef: assessmentStageResult },
  });
};

/**
 * 追加入口事实（识别准备到达、已验收风险到达）：只登记入口快照/路由事实与运行状态，
 * 状态语义由随后的恢复推进，本函数不猜测阶段（design D-02/D-08）。
 */
export const appendEntryFacts = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly cursor: WorkflowGraphRunStateV1;
  readonly stage: RiskFlowStageV1;
  readonly actionSuffix: string;
  readonly commandKind: string;
  readonly entrySnapshots?: AdvanceInputV1["entrySnapshots"];
  readonly routeDecisions: NonNullable<AdvanceInputV1["routeDecisions"]>;
}): Promise<RiskFlowGraphStateV1> => {
  const currentStage = riskFlowStageOf(input.cursor.stage, input.ports.now().toISOString());
  return await advance({
    ports: input.ports,
    run: input.run,
    cursor: input.cursor,
    stage: input.stage,
    nextStage: currentStage,
    status: input.cursor.status,
    actionSuffix: input.actionSuffix,
    commandKind: input.commandKind,
    ...(input.entrySnapshots === undefined ? {} : { entrySnapshots: input.entrySnapshots }),
    routeDecisions: input.routeDecisions,
    statePatch: {},
  });
};

/**
 * 协作式取消登记（design D-08）：只追加取消事实（路由行 + 运行汇总 + 取消态运行状态），
 * 未开始的节点不再获得调用，已提交的事实、审计与链边一律保留。
 */
export const recordRiskFlowCancellation = async (input: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly run: RiskFlowGraphRunContextV1;
  readonly cursor: WorkflowGraphRunStateV1;
  readonly cancellationRef: RouteDecisionRefV1;
  readonly reasonCode: string;
}): Promise<void> => {
  const currentStage = riskFlowStageOf(input.cursor.stage, input.ports.now().toISOString());
  const runResult = runResultFor({
    run: input.run,
    ...(input.cursor.identificationRunRef === undefined
      ? {}
      : { identificationRunRef: input.cursor.identificationRunRef }),
    assessmentRunRefs: input.cursor.assessmentRunRefs,
    acceptedRiskRecordRefs: input.cursor.acceptedRiskRecordRefs,
    refs: emptyAggregatedRefs,
    skippedTails: [
      {
        tailKind: "warning",
        reasonCode: input.reasonCode,
        ...(input.cursor.lastStageResultRef === undefined
          ? {}
          : { lastEstablishedRef: input.cursor.lastStageResultRef }),
      },
    ],
  });
  await advance({
    ports: input.ports,
    run: input.run,
    cursor: input.cursor,
    stage: currentStage,
    nextStage: currentStage,
    status: "cancelled",
    actionSuffix: `cancel:${sha256CanonicalJson({
      runVersionId: input.cursor.runVersionId,
      reasonCode: input.reasonCode,
    }).slice(0, 32)}`,
    commandKind: "risk-flow-graph.cancel",
    routeDecisions: [{ ref: input.cancellationRef, routeKind: RISK_FLOW_ROUTE_KIND_CANCELLED_V1 }],
    runResult,
    links: [],
    statePatch: { resultRef: runResultRefFor({ run: input.run, runResult }) },
  });
};

/** `result-summary`：汇总精确引用与缺席原因，形成不可变运行汇总并完成（design D-05/D-09）。 */
const stageSummarize: StageHandlerV1 = async ({ ports, run }) => {
  const cursor = await readRiskFlowCursor({ ports, run });
  if (cursor === undefined) {
    throw new RiskFlowGraphNodeFailureV1(
      contractInvalid({
        stage: "result-summary",
        detailCode: "run-cursor-missing",
        occurredAt: ports.now().toISOString(),
      }),
    );
  }
  const childRunRefs = dedupeRunRefs(cursor.assessmentRunRefs);
  const aggregate = await aggregateAssessmentSubRuns({ ports, run, childRunRefs });
  // 缺席链尾只镜像已登记的类型化原因：识别入口在无已验收风险时才有“无合格风险”这一原因，
  // 分段入口一律取子运行自己登记的原因，绝不补造占位事实（design D-09，R6/S2）。
  const skippedTails: WorkflowGraphRunResultV1["skippedTails"][number][] =
    run.entryMode === "identify-and-assess" && cursor.acceptedRiskRecordRefs.length === 0
      ? [
          {
            tailKind: "warning",
            reasonCode: RISK_FLOW_ROUTE_KIND_NO_QUALIFIED_RISK_V1,
            ...(cursor.identificationRunRef === undefined
              ? {}
              : { lastEstablishedRef: cursor.identificationRunRef }),
          },
        ]
      : [...aggregate.skippedTails];
  const runResult = runResultFor({
    run,
    ...(cursor.identificationRunRef === undefined
      ? {}
      : { identificationRunRef: cursor.identificationRunRef }),
    assessmentRunRefs: childRunRefs,
    acceptedRiskRecordRefs: cursor.acceptedRiskRecordRefs,
    refs: aggregate.refs,
    skippedTails,
  });
  const runResultStageResult = stageResultRefFor({
    runId: run.runRef.reference.entityId,
    stage: "result-summary",
    evidence: {
      runResultRef: runResult.auditTrailRef,
      evidence: runResult.auditTrailRef.reference.versionId,
    },
  });
  return await advance({
    ports,
    run,
    cursor,
    stage: "result-summary",
    nextStage: "result-summary",
    status: "completed",
    actionSuffix: `result-summary:${sha256CanonicalJson({
      cursor: cursor.runVersionId,
      evidence: aggregate.evidence,
    }).slice(0, 32)}`,
    commandKind: "risk-flow-graph.summarize",
    stageResults: [runResultStageResult],
    runResult,
    links: [
      {
        fromRef: run.runRef,
        toRef: runResultStageResult,
        relation: "run-stage",
        sourceStage: "result-summary",
        stageResultRef: runResultStageResult,
      },
    ],
    statePatch: {
      ...aggregate.refs,
      resultRef: runResultRefFor({ run, runResult }),
      lastStageResultRef: runResultStageResult,
    },
  });
};

const stageHandlers: Record<RiskFlowStageV1, StageHandlerV1> = {
  preparing: stagePrepare,
  identification: stageIdentification,
  assessment: stageAssessment,
  "result-summary": stageSummarize,
};

/** 编译 `preparing`～`result-summary` 父图；checkpointer 由组合根提供（design D-02）。 */
export const createRiskFlowGraph = (options: {
  readonly ports: RiskFlowGraphPortsV1;
  readonly checkpointer: BaseCheckpointSaver;
}): RiskFlowGraphRunnerV1 => {
  const graph = new StateGraph<
    typeof channelsAnnotation.spec,
    GraphChannelsV1,
    GraphChannelsV1,
    NodeNameV1
  >(channelsAnnotation);
  for (const stage of STAGE_SEQUENCE_V1) {
    graph.addNode(NODE_FOR_STAGE_V1[stage], async (channels, config) => {
      const occurredAt = options.ports.now().toISOString();
      const run = readRiskFlowRunContext({ config, occurredAt });
      const state = parseRiskFlowGraphState({ ...stateOfChannels(channels), stage }, occurredAt);
      try {
        return stateAsUpdate(await stageHandlers[stage]({ ports: options.ports, run, state }));
      } catch (error: unknown) {
        if (isGraphBubbleUp(error)) throw error;
        const cursor = await readRiskFlowCursor({ ports: options.ports, run });
        const rows = await readRiskFlowRows({ ports: options.ports, run });
        return stateAsUpdate(
          await recordNodeFailure({
            ports: options.ports,
            run,
            cursor,
            rows,
            stage,
            error,
          }),
        );
      }
    });
  }
  graph.addNode(WAIT_NODE_V1, async (channels, config) => {
    const occurredAt = options.ports.now().toISOString();
    const state = parseRiskFlowGraphState(stateOfChannels(channels), occurredAt);
    readRiskFlowRunContext({ config, occurredAt });
    const resumeValue: unknown = interrupt(state.waitingRefs);
    if (!isResumeValue(resumeValue)) {
      throw new RiskFlowGraphNodeFailureV1(
        contractInvalid({ stage: state.stage, detailCode: "resume-value-invalid", occurredAt }),
      );
    }
    if (state.waitingRefs.length === 0) {
      throw new RiskFlowGraphNodeFailureV1(
        contractInvalid({
          stage: state.stage,
          detailCode: "waiting-reference-missing",
          occurredAt,
        }),
      );
    }
    return stateAsUpdate(
      parseRiskFlowGraphState({ ...state, status: "running", waitingRefs: [] }, occurredAt),
    );
  });
  graph.addEdge(START, NODE_FOR_STAGE_V1.preparing);
  const routes: Record<string, NodeNameV1> = { [END]: END, [WAIT_NODE_V1]: WAIT_NODE_V1 };
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
  // `durability: "sync"`：每个 superstep 末等待检查点落库，恢复时业务事实与检查点可对账（D-08）。
  const compiled = graph.compile({ checkpointer: options.checkpointer });
  return {
    invoke: (input, config) => compiled.invoke(input.graph, { ...config, durability: "sync" }),
    resume: (input, config) =>
      compiled.invoke(
        new Command<RiskFlowResumeValueV1, GraphChannelsV1, NodeNameV1>({ resume: input.resume }),
        { ...config, durability: "sync" },
      ),
    retry: (state, config) =>
      compiled.invoke(
        new Command<RiskFlowResumeValueV1, GraphChannelsV1, NodeNameV1>({
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
        state.status === "terminal-failure"
      ) {
        return state;
      }
      return compiled.invoke(null, { ...config, durability: "sync" });
    },
    getState: (config) => compiled.getState(config),
  };
};
