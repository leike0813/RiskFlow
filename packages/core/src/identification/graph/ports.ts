import type {
  AuthorizationContextV1,
  IdentificationPreparationSnapshotRefV1,
  IdentificationRunResultRefV1,
} from "@riskflow/contracts/ports";
import type { IdentificationGraphStateV1 } from "@riskflow/contracts/workflows";

import type {
  IdentificationGraphPolicySetV1,
  IdentificationGraphResultRowV1,
  IdentificationGraphRunResultV1,
  IdentificationGraphRunStateV1,
} from "./schema.js";

/**
 * 由组合根注入的已审核策略目录（design D-03）：只按精确引用解析同一版本组合，保留历史版本，
 * 无内建业务默认值与“最新版”回退。同一目录同时承载 C17/C21/C22 的策略正文。
 */
export interface IdentificationGraphPolicySetProviderV1 {
  resolveExact(input: {
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationGraphPolicySetV1 | undefined>;
}

/**
 * C24 追加登记端口（design D-06/D-07）：正文只在 C04，本端口只登记与回读引用行。
 * 登记、审计与命令回执由实现在同一 C03 业务事务内提交；同键异载荷返回不可重试冲突。
 */
export interface IdentificationGraphRegistrationStoreV1 {
  assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context: unknown,
  ): Promise<void>;
  registerRow(
    input: {
      readonly row: IdentificationGraphResultRowV1;
      readonly occurredAt: string;
    },
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
  /**
   * D-05 已完成运行汇总精确只读（C36 覆盖证明的唯一入口）：先按当前授权读取 `run-result`
   * 登记行与其 C04 正文，再核对最新 `run-state` 为 `completed` 且指向同一结果，返回前再次
   * 复验授权。缺失、撤权、跨工程、状态或正文不一致一律返回 `unavailable`；登记/正文损坏
   * 返回 `corrupt`，不把空数组或旧运行冒充覆盖证明。
   */
  readCompletedRunResult(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly runResultRef: IdentificationRunResultRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "read"; readonly runResult: IdentificationGraphRunResultV1 }
    | { readonly kind: "unavailable" }
    | { readonly kind: "corrupt"; readonly detailCode: string }
  >;
}

/**
 * C24 内部识别子图运行时（design D-01）：`start`/`resume`/`cancel` 三个命令复用既有
 * `WorkflowPortV1` 语义，不新增公共契约；C30 后续通过父运行调用本入口。
 */
export interface IdentificationGraphRuntimeV1 {
  start(command: IdentificationGraphStartCommandV1): Promise<IdentificationGraphRunOutcomeV1>;
  resume(command: IdentificationGraphResumeCommandV1): Promise<IdentificationGraphRunOutcomeV1>;
  cancel(command: IdentificationGraphCancelCommandV1): Promise<IdentificationGraphRunOutcomeV1>;
}

export interface IdentificationGraphStartCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
  readonly graphVersion: { readonly entityId: string; readonly versionId: string };
  readonly parentRiskFlowRunRef: {
    readonly kind: "workflow-run";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly triggerReasonCode: string;
}

export interface IdentificationGraphResumeCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
  readonly runRef: {
    readonly kind: "workflow-run";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly expectedRunVersionId: string;
  readonly resumeCause: IdentificationGraphResumeCauseV1;
}

export type IdentificationGraphResumeCauseV1 =
  | {
      readonly kind: "agent-task-completed";
      readonly agentTaskRef: {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
    }
  | {
      readonly kind: "review-resolved";
      readonly reviewDecisionRef: {
        readonly kind: "review-decision";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
    }
  | { readonly kind: "transient-recovered" };

export interface IdentificationGraphCancelCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
  readonly runRef: {
    readonly kind: "workflow-run";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly expectedRunVersionId: string;
  readonly reasonCode: string;
}

/** 运行命令的闭合结果（design D-01）：只返回既有运行引用、状态与引用集合。 */
export interface IdentificationGraphRunOutcomeV1 {
  readonly state: IdentificationGraphStateV1;
  readonly runVersionId: string;
  readonly disposition:
    "created" | "existing" | "resumed" | "already-cancelled" | "cancellation-recorded";
}
