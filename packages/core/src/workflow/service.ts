/**
 * C30 运行事实服务（design D-01/D-02/D-05/D-08）：入口冻结门禁、父子身份与状态版本派生、
 * 幂等摘要、checkpoint 对账与失败分类。全部为确定性纯函数或类型化端口，不复制领域规则。
 */
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import type { VersionReference } from "@riskflow/contracts/common";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  ContractReferenceV1,
  ModuleErrorV1,
  ModuleBranchV1,
  MonitoringSnapshotRefV1,
  RiskAssessmentRecordRefV1,
  SpatialScopeRefV1,
  StageResultRefV1,
  StartWorkflowRunCommandV1,
  WorkflowEntryModeV1,
  WorkflowErrorRefV1,
  WorkflowReassessmentInputV1,
  WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { WorkflowReassessmentReasonV1 } from "@riskflow/contracts/vocabulary";

import {
  WorkflowGraphErrorV1Schema,
  type AssessmentEntryMetadataV1,
  type AssessmentRunProjectionV1,
  type WorkflowGraphArtifactBodyV1,
  type WorkflowGraphErrorCodeV1,
  type WorkflowGraphErrorV1,
  type WorkflowGraphLinkV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
  type WorkflowQueryRegistrationV1,
  type WorkflowRunStageV1,
} from "./schema.js";

/** 公共启动载荷：C30 门禁只读这些加法字段，不改旧字段语义（design D-01）。 */
export type WorkflowStartPayloadV1 = StartWorkflowRunCommandV1["payload"];

/** 逐空间配对上下文：与公共载荷`assessmentContexts`同形（design D-01）。 */
export interface WorkflowAssessmentContextV1 {
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1;
  readonly monitoringSnapshotRefs?: readonly MonitoringSnapshotRefV1[] | undefined;
}

/** 登记结果：同键同载荷重放返回既有事实，异载荷为不可重试冲突（design D-08）。 */
export type WorkflowRegisterOutcomeV1 =
  | { readonly kind: "registered"; readonly replayed: boolean }
  | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string };

/**
 * C30 只追加登记端口（design D-05）：登记、审计与命令回执在同一 C03 业务事务内提交；
 * 传入 `context` 时复用调用方事务，缺省时自行开启。只 INSERT，新状态追加版本。
 */
export interface WorkflowGraphRegistrationStoreV1 {
  assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context?: unknown,
  ): Promise<void>;
  registerRow(
    input: { readonly row: WorkflowGraphResultRowV1; readonly occurredAt: string },
    context?: unknown,
  ): Promise<WorkflowRegisterOutcomeV1>;
  readRow(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly resultKind: WorkflowGraphResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<WorkflowGraphResultRowV1 | undefined>;
  listRunRows(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowGraphResultRowV1[]>;
  readLatestRunState(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    /**
     * 复验身份：调用方 `authorization` 实际签发时的 `invocationId`（运行/命令身份）。
     * 端口 MUST NOT 自行派生——派生字符串没有签发方，复验必然拒结，游标会恒为空，
     * 运行版本断言随之失效（与 `readBody`/`putBody` 同一要求）。
     */
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly row: WorkflowGraphResultRowV1 & { readonly resultKind: "run-state" };
        readonly state: WorkflowGraphRunStateV1;
      }
    | undefined
  >;
  registerLink(
    input: { readonly link: WorkflowGraphLinkV1 },
    context?: unknown,
  ): Promise<WorkflowRegisterOutcomeV1>;
  listRunLinks(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowGraphLinkV1[]>;
  registerQuery(input: {
    readonly registration: WorkflowQueryRegistrationV1;
  }): Promise<WorkflowRegisterOutcomeV1>;
  readQuery(input: {
    readonly projectId: string;
    readonly queryResultId: string;
    readonly queryResultVersionId: string;
  }): Promise<WorkflowQueryRegistrationV1 | undefined>;
}

/** C04 正文端口（design D-05）：正文只入 C04，登记行只保存精确引用。 */
export interface WorkflowGraphBodyPortV1 {
  putBody(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly commandId: string;
    readonly issuedAt: string;
    readonly artifactId: string;
    readonly body: WorkflowGraphArtifactBodyV1;
    /**
     * 复验身份：调用方 `authorization` 实际签发时的 `invocationId`。端口 MUST NOT 自行派生
     * ——`c30-body-write:…` 这类字符串没有任何生产签发方，调用方只能用运行/命令的真实身份
     * 换取上下文，派生身份会让复验必然拒结。必填，不提供可选分支（与 `readBody` 同一要求）。
     */
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ContentArtifactRefV1>;
  readBody(input: {
    readonly projectId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    /**
     * 调用方派生的复验身份。必填且不得由端口内部固定派生：正文读取的身份必须与本次
     * 读取所依据的授权上下文配对，固定身份会让同一工件的第二次读取与第一次争抢同一个
     * `invocation_id`，从而在 C06 重放比对处必然冲突（design D2）。
     */
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphArtifactBodyV1 | undefined>;
}

/**
 * C30 端口受保护读写的调用身份（design D-05）：C06 复验要求授权的签发身份与复验身份一致，
 * 因此调用方必须在换取下游授权前用同一函数派生身份。签发方与复验方共用这一事实源，
 * 任何一方自行拼字符串都会让复验按拒绝收口。
 */
export const workflowGraphInvocationIdV1 = (input: {
  readonly operation:
    | "result-row"
    | "run-rows"
    | "run-state"
    | "run-links"
    | "query-registration"
    | "body-write"
    | "body-read"
    | "assessment-entries"
    | "run-read";
  readonly projectId: string;
  readonly targetId: string;
}): string => `c30-${input.operation}:${input.projectId}:${input.targetId}`;

/**
 * C30 入口元数据窄读（design D-12）：输入当前获准的评估记录引用，逐项返回已登记的精确运行身份
 * 与重评入口事实。实现只沿自己的正式结果登记/链边定位入口行与精确 run-state 工件；重评元数据
 * 缺失、错配或不可读时整体失败闭合，不得用 `frozenRefs`、`triggerReasonCode` 或启发式补齐。
 *
 * `authorization` 必须是调用方以 `workflowGraphInvocationIdV1({operation:"assessment-entries",
 * targetId: assessmentRecordRefs[0]})` 换取的下游授权；C30 沿同一身份复验当前授权。
 */
export interface AssessmentEntriesReadPortV1 {
  readAssessmentEntriesForRecords(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRefs: readonly RiskAssessmentRecordRefV1[];
  }): Promise<
    | { readonly kind: "succeeded"; readonly entries: readonly AssessmentEntryMetadataV1[] }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/**
 * C30 运行投影窄读（design D-04）：按精确运行引用返回该运行已登记的身份、阶段与结果引用。
 * 目标为评估子运行时直接呈现其 A0～A9；目标为父运行时保留父 status/stage/R 阶段与真实子运行
 * 引用，只在显式选中或唯一子运行时才读子运行阶段。子运行引用先验证确属该精确父运行再读；
 * 读不到或不成立一律失败，不用 checkpoint 或合成轨迹替代。
 *
 * `authorization` 必须是调用方以 `workflowGraphInvocationIdV1({operation:"run-read",
 * targetId: workflowRunRef})` 换取的下游授权。
 */
export interface AssessmentRunReadPortV1 {
  readAssessmentRun(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly workflowRunRef: WorkflowRunRefV1;
    readonly assessmentRunRef?: WorkflowRunRefV1;
    readonly resultCursor?: string;
    readonly reviewTaskCursor?: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly projection: AssessmentRunProjectionV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/**
 * C30 运行面：父图用它启动/恢复/取消评估子运行，`WorkflowPortV1` 实现用它驱动父运行。
 * 只承载精确引用与闭合状态，不复制公共图状态机。
 */
export interface WorkflowGraphRunCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  /**
   * 已签发的调用身份：`authorization` 实际签发时的 `invocationId`。
   *
   * 评估子运行沿用父运行的公开命令上下文（同一个授权上下文），但它自己的业务命令身份
   * `c30-assessment-start:*` 与该上下文的签发身份不同。C06 一个授权上下文只对应一个
   * invocation_id，运行控制复验必须用本字段，否则必然被判绑定不符。必填，不提供可选分支。
   */
  readonly issuedInvocationId: string;
  /**
   * `authorization` 实际签发时的模块分支：与 `issuedInvocationId` 同源，二者缺一都不足以复验。
   *
   * 评估子运行沿用父运行的公开命令上下文，因此它自己启动时用的分支取决于父运行由哪条命令
   * 推进（启动 `workflow.start-run`、恢复 `workflow.resume-run`）。把签发分支显式带下来，
   * 子运行才不至于按自己的入口习惯硬编码分支——那会把「上下文有效」误判为「越权」。
   */
  readonly authorizationBranch: ModuleBranchV1;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  readonly graphVersion: VersionReference;
  readonly retryPolicyRef: VersionReference;
  readonly runRef: WorkflowRunRefV1;
  readonly threadId: string;
  readonly entryMode: WorkflowEntryModeV1;
  /** C30 派生的入口身份：只用公共 `VersionReference` 形状，不伪造公共引用 kinds。 */
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly parentRunRef?: WorkflowRunRefV1;
  /** `identify-and-assess` 把真实父身份交给 C24；评估子运行携带其验收风险记录。 */
  readonly acceptedRiskRecordRef?: ContractReferenceV1;
  readonly spatialScopeRef?: SpatialScopeRefV1;
  readonly applicabilityMetadataSnapshotRef?: ApplicabilityMetadataSnapshotRefV1;
  readonly monitoringSnapshotRefs?: readonly MonitoringSnapshotRefV1[];
  readonly assessmentRunRefs?: readonly WorkflowRunRefV1[];
  /**
   * 重评入口不可变事实（design D-12）：父公开 `startRunPort` 从解析后的 `reassess` 载荷原样
   * 取出，经 `WorkflowGraphRunCommandV1` 传给子运行与 run-state 工件。原
   * `previousAssessmentRecordRef` 接缝改从该对象取值，不保留可独立改变的第二套前驱。
   */
  readonly reassessmentEntry?: WorkflowReassessmentInputV1;
}

export interface WorkflowGraphRunOutcomeV1 {
  readonly runRef: WorkflowRunRefV1;
  /**
   * 运行状态版本：与 `runRef` 同源，都取自本次推进结束时已登记的 run-state 行，但两者语义不同
   * ——`runRef.reference.versionId` 是运行登记摘要，`runVersionId` 是运行**状态**版本（drift
   * design D-01）。等待分支据此把它作为等待点状态版本交出，恢复要提交的就是这个值。
   */
  readonly runVersionId: string;
  readonly status: WorkflowGraphRunStateV1["status"];
  readonly stage: WorkflowRunStageV1;
  readonly assessmentRunRefs: readonly WorkflowRunRefV1[];
  readonly lastStageResultRef?: StageResultRefV1;
  readonly lastWaitingRef?: WorkflowGraphRunStateV1["lastWaitingRef"];
  readonly resultRef?: ContractReferenceV1;
  readonly errorRef?: WorkflowErrorRefV1;
}

/** 图运行时端口：`start`/`resume`/`cancel` 复用 `WorkflowPortV1` 语义，不新增公共契约。 */
export interface WorkflowGraphRuntimePortV1 {
  start(command: WorkflowGraphRunCommandV1): Promise<WorkflowGraphRunOutcomeV1>;
  resume(
    command: WorkflowGraphRunCommandV1 & {
      readonly expectedRunVersionId: string;
      readonly resumeCause: unknown;
    },
  ): Promise<WorkflowGraphRunOutcomeV1>;
  cancel(
    command: WorkflowGraphRunCommandV1 & { readonly reasonCode: string },
  ): Promise<WorkflowGraphRunOutcomeV1>;
}

/** 评估子运行入口（父图消费）：与 `WorkflowGraphRuntimePortV1` 同形，入口语义固定。 */
export type AssessmentRunRuntimeV1 = WorkflowGraphRuntimePortV1;

export const workflowRequestDigest = (input: unknown): string => sha256CanonicalJson(input);

/** 稳定运行身份：同一入口、同一冻结身份与图版本只对应一个运行与线程（design D-02）。 */
export const workflowRunIdentityFor = (input: {
  readonly projectId: string;
  readonly entryMode: WorkflowEntryModeV1;
  readonly entryIdentity: VersionReference;
  readonly graphVersion: VersionReference;
}): { readonly runRef: WorkflowRunRefV1; readonly threadId: string } => {
  const digest = sha256CanonicalJson({
    projectId: input.projectId,
    entryMode: input.entryMode,
    entryIdentity: input.entryIdentity,
    graphVersion: input.graphVersion,
  });
  return {
    runRef: {
      kind: "workflow-run",
      reference: {
        // 运行身份含精确输入摘要：同工程同入口的不同输入是两个独立运行，不共享运行分区。
        entityId: `risk-flow-run:${input.projectId}:${input.entryMode}:${digest.slice(0, 32)}`,
        versionId: digest,
      },
    },
    threadId: `risk-flow-run-thread:${input.projectId}:${digest}`,
  };
};

/** 逐验收风险版本一个评估子运行：同一父运行的同一风险版本不得出现第二个身份（design D-02）。 */
export const assessmentSubRunIdentityFor = (input: {
  readonly projectId: string;
  readonly parentRunRef: WorkflowRunRefV1;
  readonly riskRecordRef: ContractReferenceV1;
}): { readonly runRef: WorkflowRunRefV1; readonly threadId: string } => {
  const digest = sha256CanonicalJson({
    projectId: input.projectId,
    parentRunRef: input.parentRunRef,
    riskRecordRef: input.riskRecordRef,
  });
  return {
    runRef: {
      kind: "workflow-run",
      reference: {
        // 每条验收风险版本一个独立运行分区：兄弟子运行不得共享运行 id（design D-02）。
        entityId: `assessment-run:${input.projectId}:${input.parentRunRef.reference.entityId}:${digest.slice(0, 32)}`,
        versionId: digest,
      },
    },
    threadId: `assessment-run-thread:${input.projectId}:${digest}`,
  };
};

/**
 * 分段入口（`assess`/`reassess`/`historical-backfill`/`forecast-response`/`record-response-feedback`）
 * 的评估子运行身份：这些运行没有逐风险记录，按父运行、入口与入口身份派生唯一子运行（design D-02/D-04）。
 */
export const segmentedAssessmentSubRunIdentityFor = (input: {
  readonly projectId: string;
  readonly parentRunRef: WorkflowRunRefV1;
  readonly entryMode: WorkflowEntryModeV1;
  readonly entryIdentity: VersionReference;
}): { readonly runRef: WorkflowRunRefV1; readonly threadId: string } => {
  const digest = sha256CanonicalJson({
    projectId: input.projectId,
    parentRunRef: input.parentRunRef,
    entryMode: input.entryMode,
    entryIdentity: input.entryIdentity,
  });
  return {
    runRef: {
      kind: "workflow-run",
      reference: {
        // 分段入口子运行同样独立分区：同一父运行下不同入口身份不共享运行 id（design D-02）。
        entityId: `assessment-run:${input.projectId}:${input.parentRunRef.reference.entityId}:${digest.slice(0, 32)}`,
        versionId: digest,
      },
    },
    threadId: `assessment-run-thread:${input.projectId}:${digest}`,
  };
};

/** 首版运行状态版本：只由身份、入口与记录时刻决定，不猜测“最新”。 */
export const initialRunVersionId = (input: {
  readonly runId: string;
  readonly entryMode: WorkflowEntryModeV1;
  readonly recordedAt: string;
}): string => sha256CanonicalJson({ ...input, ordinal: 0 });

/** 追加式运行状态版本：只由前一版本、阶段、状态与时刻决定（design D-05）。 */
export const nextRunVersionId = (input: {
  readonly runId: string;
  readonly previousRunVersionId: string;
  readonly stage: WorkflowRunStageV1;
  readonly status: WorkflowGraphRunStateV1["status"];
  readonly recordedAt: string;
}): string => sha256CanonicalJson(input);

const stageOrderV1: Readonly<Record<string, number>> = {
  preparing: 0,
  identification: 1,
  assessment: 2,
  "result-summary": 3,
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
  A6: 6,
  A7: 7,
  A8: 8,
  A9: 9,
};

/** checkpoint 与业务登记行的相对位置（design D-08）：只有“业务领先一格”允许补一个可证明增量。 */
export const reconcileCheckpointReference = (input: {
  readonly checkpointStage: WorkflowRunStageV1;
  readonly registeredStage: WorkflowRunStageV1;
}): "consistent" | "business-ahead" | "checkpoint-ahead" | "inconsistent" => {
  const checkpoint = stageOrderV1[input.checkpointStage];
  const registered = stageOrderV1[input.registeredStage];
  if (checkpoint === undefined || registered === undefined) return "inconsistent";
  if (checkpoint === registered) return "consistent";
  if (registered === checkpoint + 1) return "business-ahead";
  if (checkpoint === registered + 1) return "checkpoint-ahead";
  return "inconsistent";
};

const retryableFailureCodesV1: Readonly<Record<WorkflowGraphErrorCodeV1, true | undefined>> = {
  RETRYABLE_INFRASTRUCTURE_FAILURE: true,
  ENTRY_REFERENCES_INCOMPLETE: undefined,
  UPSTREAM_WAITING: undefined,
  AUTHORIZATION_DENIED: undefined,
  VERSION_CONFLICT: undefined,
  IDEMPOTENCY_CONFLICT: undefined,
  CHECKPOINT_INCONSISTENT: undefined,
  CONTRACT_INVALID: undefined,
  CANCELLED: undefined,
  RUN_NOT_FOUND: undefined,
  RUN_TERMINATED: undefined,
};

export const isRetryableWorkflowGraphError = (code: WorkflowGraphErrorCodeV1): boolean =>
  retryableFailureCodesV1[code] === true;

/** 上游模块错误到 C30 错误码的确定性收口（design D-07/D-08）：权限与冲突不重试。 */
export const classifyWorkflowGraphFailure = (input: {
  readonly stage: WorkflowRunStageV1;
  readonly upstream: { readonly code: string; readonly retryable: boolean };
  readonly detailCode: string;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 => {
  const code: WorkflowGraphErrorCodeV1 = (() => {
    switch (input.upstream.code) {
      case "AUTHORIZATION_DENIED":
        return "AUTHORIZATION_DENIED";
      case "IDEMPOTENCY_CONFLICT":
        return "IDEMPOTENCY_CONFLICT";
      case "STALE_VERSION":
        return "VERSION_CONFLICT";
      case "CHECKPOINT_INCONSISTENT":
        return "CHECKPOINT_INCONSISTENT";
      case "ENTITY_NOT_FOUND":
        return "RUN_NOT_FOUND";
      case "UPSTREAM_WAITING":
        return "UPSTREAM_WAITING";
      case "CANCELLED":
        return "CANCELLED";
      default:
        return input.upstream.retryable ? "RETRYABLE_INFRASTRUCTURE_FAILURE" : "CONTRACT_INVALID";
    }
  })();
  return WorkflowGraphErrorV1Schema.parse({
    schemaVersion: "1",
    code,
    retryable: code === "RETRYABLE_INFRASTRUCTURE_FAILURE",
    stage: input.stage,
    detailCode: input.detailCode,
    occurredAt: input.occurredAt,
  });
};

const refKey = (
  ref: ContractReferenceV1 | { readonly kind: string; readonly reference: VersionReference },
): string =>
  "reference" in ref
    ? `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`
    : `domain-event/${ref.eventId}/${ref.eventVersion}`;

/** 监测输入规范化结果（design D-01）：只允许等价单项，缺项与冲突分开表达。 */
export type NormalizedMonitoringInputsV1 =
  | { readonly kind: "ok"; readonly refs: readonly MonitoringSnapshotRefV1[] }
  | { readonly kind: "conflict" }
  /**
   * 显式空集合：调用方声明了监测输入集合却是空的，与 `absent` 区分并在入口门禁拒绝。
   */
  | { readonly kind: "missing" }
  /**
   * 字段缺席（design D-12）：单数字段与多数字段都未提供，表示本次入口不携带监测输入。
   * 与显式空集合是两种不同事实，入口门禁按无监测输入继续，不补默认监测。
   */
  | { readonly kind: "absent" };

const normalize = (
  refs: readonly MonitoringSnapshotRefV1[] | undefined,
): NormalizedMonitoringInputsV1 => {
  if (refs === undefined) return { kind: "absent" };
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) return { kind: "conflict" };
    seen.add(key);
  }
  return refs.length === 0 ? { kind: "missing" } : { kind: "ok", refs };
};

/**
 * 单数与多序列监测输入规范化（design D-01）：只接受等价单项，互相冲突或需要推断的缺项拒绝；
 * 规范化不引入任何“当前值”或“最新版”回退。
 */
export const normalizeMonitoringInputs = (input: {
  readonly monitoringSnapshotRef?: MonitoringSnapshotRefV1 | undefined;
  readonly monitoringSnapshotRefs?: readonly MonitoringSnapshotRefV1[] | undefined;
}): NormalizedMonitoringInputsV1 => {
  const plural = normalize(input.monitoringSnapshotRefs);
  const singular = input.monitoringSnapshotRef;
  // 两字段均缺席：本次入口不携带监测输入（design D-12），不补默认监测。
  if (singular === undefined) return plural;
  if (plural.kind === "absent") return { kind: "ok", refs: [singular] };
  if (plural.kind !== "ok") return plural;
  if (
    plural.refs.length !== 1 ||
    refKey(plural.refs[0] as MonitoringSnapshotRefV1) !== refKey(singular)
  ) {
    return { kind: "conflict" };
  }
  return plural;
};

export type WorkflowEntryGateV1 =
  | {
      readonly kind: "ready";
      readonly frozenRefs: readonly ContractReferenceV1[];
      readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
      readonly assessmentContexts: readonly WorkflowAssessmentContextV1[];
    }
  | { readonly kind: "incomplete"; readonly detailCode: string }
  | { readonly kind: "missing"; readonly detailCode: string }
  | { readonly kind: "conflict"; readonly detailCode: string }
  | { readonly kind: "waiting"; readonly detailCode: string };

const assessmentContextKey = (context: WorkflowAssessmentContextV1): string =>
  refKey(context.spatialScopeRef);

/**
 * 正式运行前置门禁（design D-01）：冻结引用必须齐全、相容且当前可见；缺失或冲突在创建正式
 * 评估准备、P/C 或评估成功事实之前失败，不推断“最新版”。
 */
export const evaluateWorkflowEntryGate = (payload: WorkflowStartPayloadV1): WorkflowEntryGateV1 => {
  switch (payload.entryMode) {
    case "identify-and-assess": {
      const contexts = payload.assessmentContexts;
      if (contexts === undefined || contexts.length === 0) {
        return { kind: "incomplete", detailCode: "assessment-contexts-missing" };
      }
      const spaces = payload.spatialScopeRefs;
      const paired = new Map<string, WorkflowAssessmentContextV1>();
      for (const context of contexts) {
        const key = assessmentContextKey(context);
        if (paired.has(key))
          return { kind: "conflict", detailCode: "assessment-context-duplicate" };
        paired.set(key, context);
      }
      for (const space of spaces) {
        if (!paired.has(refKey(space))) {
          return { kind: "incomplete", detailCode: "assessment-context-missing" };
        }
      }
      if (paired.size !== spaces.length) {
        return { kind: "conflict", detailCode: "assessment-context-unpaired" };
      }
      const perContext: {
        readonly context: WorkflowAssessmentContextV1;
        readonly monitoring: readonly MonitoringSnapshotRefV1[];
      }[] = [];
      for (const context of contexts) {
        const normalized = normalize(context.monitoringSnapshotRefs);
        if (context.monitoringSnapshotRefs !== undefined && normalized.kind !== "ok") {
          return { kind: "conflict", detailCode: "monitoring-input" };
        }
        perContext.push({ context, monitoring: normalized.kind === "ok" ? normalized.refs : [] });
      }
      const legacy = payload.monitoringSnapshotRef;
      if (legacy !== undefined) {
        if (contexts.length !== 1) {
          return { kind: "conflict", detailCode: "monitoring-input" };
        }
        const only = perContext[0] as {
          readonly context: WorkflowAssessmentContextV1;
          readonly monitoring: readonly MonitoringSnapshotRefV1[];
        };
        if (
          only.monitoring.length !== 1 ||
          refKey(only.monitoring[0] as MonitoringSnapshotRefV1) !== refKey(legacy)
        ) {
          return { kind: "conflict", detailCode: "monitoring-input" };
        }
      }
      const frozenRefs: ContractReferenceV1[] = [
        payload.projectRevisionRef,
        ...spaces,
        ...payload.sourceVersionRefs,
        ...contexts.map((context) => context.applicabilityMetadataSnapshotRef),
        ...perContext.flatMap((entry) => entry.monitoring),
      ];
      return {
        kind: "ready",
        frozenRefs: dedupeRefs(frozenRefs),
        monitoringSnapshotRefs: dedupeRefs(perContext.flatMap((entry) => entry.monitoring)),
        assessmentContexts: perContext.map((entry) => ({
          ...entry.context,
          monitoringSnapshotRefs: entry.monitoring.length > 0 ? entry.monitoring : undefined,
        })),
      };
    }
    case "assess":
    case "reassess":
    case "historical-backfill": {
      if (payload.projectRevisionRef === undefined) {
        return { kind: "incomplete", detailCode: "project-revision-missing" };
      }
      if (payload.spatialScopeRef === undefined) {
        return { kind: "incomplete", detailCode: "spatial-scope-missing" };
      }
      if (payload.applicabilityMetadataSnapshotRef === undefined) {
        return { kind: "incomplete", detailCode: "applicability-metadata-missing" };
      }
      const monitoring = normalizeMonitoringInputs(payload);
      // design D-12：两字段均缺席表示本次入口不携带监测输入，按无监测继续；显式空集合、
      // 两字段冲突与非法引用仍拒绝，不补默认监测。
      const monitoringRefs = monitoring.kind === "ok" ? monitoring.refs : [];
      if (monitoring.kind !== "ok" && monitoring.kind !== "absent") {
        return { kind: monitoring.kind, detailCode: "monitoring-input" };
      }
      const riskInput = payload.riskInput;
      if (riskInput === undefined) {
        return { kind: "incomplete", detailCode: "risk-input-missing" };
      }
      // frozenRefs 仍是全部获准输入集合；重评的变化引用与其相交或重复不改变
      // reassessmentEntry 的内容（design D-12）。
      const frozenRefs: ContractReferenceV1[] = [
        payload.projectRevisionRef,
        payload.spatialScopeRef,
        payload.applicabilityMetadataSnapshotRef,
        riskInput,
        ...monitoringRefs,
        ...(payload.entryMode === "historical-backfill"
          ? [payload.assessmentBasisReleaseSetRef]
          : []),
        ...(payload.entryMode === "reassess" ? payload.changedInputRefs : []),
      ];
      return {
        kind: "ready",
        frozenRefs: dedupeRefs(frozenRefs),
        monitoringSnapshotRefs: dedupeRefs(monitoringRefs),
        assessmentContexts: [],
      };
    }
    case "forecast-response":
    case "record-response-feedback": {
      if (payload.assessmentBasisReleaseSetRef === undefined) {
        return { kind: "incomplete", detailCode: "assessment-basis-missing" };
      }
      // 分段入口不重新准备评估：显式给出的冻结评估依据（C25 输入快照）必须原样进入子运行冻结输入，
      // 使 A0/A2 按该精确版本取用，而不是回退到“最新”或现场重算（design D-04）。
      const frozenAssessmentBasisRefs: readonly ContractReferenceV1[] =
        payload.frozenAssessmentBasisRef === undefined ? [] : [payload.frozenAssessmentBasisRef];
      const frozenRefs: ContractReferenceV1[] =
        payload.entryMode === "forecast-response"
          ? [
              payload.adoptedRecommendationRef,
              payload.preActionMonitoringSnapshotRef,
              payload.assessmentBasisReleaseSetRef,
              ...frozenAssessmentBasisRefs,
            ]
          : [
              payload.executionRecordRef,
              payload.feedbackRef,
              payload.assessmentBasisReleaseSetRef,
              ...(payload.forecastRef === undefined ? [] : [payload.forecastRef]),
              ...frozenAssessmentBasisRefs,
            ];
      return {
        kind: "ready",
        frozenRefs: dedupeRefs(frozenRefs),
        monitoringSnapshotRefs: [],
        assessmentContexts: [],
      };
    }
  }
};

const dedupeRefs = <T extends ContractReferenceV1>(refs: readonly T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
};

/**
 * 父子入口身份的唯一构造函数（design D-12）。
 *
 * 父公开 `startRunPort` 与子 runtime 的 `entryIdentityConsistent` 都调用它；非重评不携带
 * `reassessmentEntry`，身份摘要与其原值完全一致。父入口身份摘要包含现有冻结输入与完整
 * `reassessmentEntry`，因此不同前驱、原因或变化引用不会共享同一个运行分区。摘要沿用
 * 现有 canonical JSON，不引入额外哈希门禁。
 */
export const workflowEntryIdentityFor = (input: {
  readonly entryMode: WorkflowEntryModeV1;
  readonly projectId: string;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly reassessmentEntry?: WorkflowReassessmentInputV1 | undefined;
}): VersionReference => ({
  entityId: `workflow-entry:${input.projectId}:${input.entryMode}`,
  versionId: sha256CanonicalJson({
    entryMode: input.entryMode,
    projectId: input.projectId,
    frozenRefs: input.frozenRefs.map(refKey).sort(),
    ...(input.reassessmentEntry === undefined
      ? {}
      : {
          reassessmentEntry: {
            previousAssessmentRecordRef: refKey(
              input.reassessmentEntry.previousAssessmentRecordRef,
            ),
            reason: input.reassessmentEntry.reason,
            changedInputRefs: input.reassessmentEntry.changedInputRefs.map(refKey).sort(),
          },
        }),
  }),
});

/**
 * 重评原因的唯一映射（design D-12）。
 *
 * 工作流入口使用 `weight-strategy`，C25 侧沿其既有公开契约使用 `weight-or-strategy`；
 * 只有这一项需要改名，其余四码原样透传。Worker A2 直接调用本函数，从按 `frozenRefs`
 * 数量推导原因的启发式改为读取已登记的入口原因，不再猜测“最新原因”。
 */
export const assessmentReasonForWorkflowReassessmentV1 = (
  reason: WorkflowReassessmentReasonV1,
):
  | "monitoring-snapshot"
  | "applicability-metadata"
  | "applicable-rule-set"
  | "weight-or-strategy"
  | "risk-matrix" => (reason === "weight-strategy" ? "weight-or-strategy" : reason);

/** 从公开 `reassess` 启动载荷取出不可变重评入口事实；非重评返回 undefined。 */
export const reassessmentEntryFromStartPayloadV1 = (
  payload: WorkflowStartPayloadV1,
): WorkflowReassessmentInputV1 | undefined =>
  payload.entryMode === "reassess"
    ? {
        previousAssessmentRecordRef: payload.previousAssessmentRecordRef,
        reason: payload.reason,
        changedInputRefs: payload.changedInputRefs,
      }
    : undefined;
