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
  MonitoringSnapshotRefV1,
  SpatialScopeRefV1,
  StageResultRefV1,
  StartWorkflowRunCommandV1,
  WorkflowEntryModeV1,
  WorkflowErrorRefV1,
  WorkflowRunRefV1,
} from "@riskflow/contracts/ports";

import {
  WorkflowGraphErrorV1Schema,
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
    readonly authorization: AuthorizationContextV1;
  }): Promise<ContentArtifactRefV1>;
  readBody(input: {
    readonly projectId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WorkflowGraphArtifactBodyV1 | undefined>;
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
  readonly previousAssessmentRecordRef?: ContractReferenceV1;
}

export interface WorkflowGraphRunOutcomeV1 {
  readonly runRef: WorkflowRunRefV1;
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
  | { readonly kind: "missing" };

const normalize = (
  refs: readonly MonitoringSnapshotRefV1[] | undefined,
): NormalizedMonitoringInputsV1 => {
  if (refs === undefined) return { kind: "missing" };
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
  if (singular === undefined) return plural;
  if (input.monitoringSnapshotRefs === undefined) return { kind: "ok", refs: [singular] };
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
      if (monitoring.kind !== "ok") {
        return { kind: monitoring.kind, detailCode: "monitoring-input" };
      }
      const riskInput = payload.riskInput;
      if (riskInput === undefined) {
        return { kind: "incomplete", detailCode: "risk-input-missing" };
      }
      const frozenRefs: ContractReferenceV1[] = [
        payload.projectRevisionRef,
        payload.spatialScopeRef,
        payload.applicabilityMetadataSnapshotRef,
        riskInput,
        ...monitoring.refs,
        ...(payload.entryMode === "historical-backfill"
          ? [payload.assessmentBasisReleaseSetRef]
          : []),
        ...(payload.entryMode === "reassess" ? payload.changedInputRefs : []),
      ];
      return {
        kind: "ready",
        frozenRefs: dedupeRefs(frozenRefs),
        monitoringSnapshotRefs: dedupeRefs(monitoring.refs),
        assessmentContexts: [],
      };
    }
    case "forecast-response":
    case "record-response-feedback": {
      if (payload.assessmentBasisReleaseSetRef === undefined) {
        return { kind: "incomplete", detailCode: "assessment-basis-missing" };
      }
      const frozenRefs: ContractReferenceV1[] =
        payload.entryMode === "forecast-response"
          ? [
              payload.adoptedRecommendationRef,
              payload.preActionMonitoringSnapshotRef,
              payload.assessmentBasisReleaseSetRef,
            ]
          : [
              payload.executionRecordRef,
              payload.feedbackRef,
              payload.assessmentBasisReleaseSetRef,
              ...(payload.forecastRef === undefined ? [] : [payload.forecastRef]),
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

/** 入口身份引用：同一命令载荷只对应一个运行身份（design D-02）。 */
export const workflowEntryIdentityFor = (input: {
  readonly entryMode: WorkflowEntryModeV1;
  readonly projectId: string;
  readonly frozenRefs: readonly ContractReferenceV1[];
}): VersionReference => ({
  entityId: `workflow-entry:${input.projectId}:${input.entryMode}`,
  versionId: sha256CanonicalJson({
    entryMode: input.entryMode,
    projectId: input.projectId,
    frozenRefs: input.frozenRefs.map(refKey).sort(),
  }),
});
