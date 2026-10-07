/**
 * C41 人工决定与反馈命令组合（design D1–D6）。
 *
 * 本模块只做受控组合：按当前 C06 授权复验人工命令，把 C28 私有命令、C30 真实运行与 C25 精确评估
 * 按已批准顺序接起来，并把 C41 自有终局决定与冻结输入交给注入的适配器。它不复制任何领域规则，
 * 不代替人做决定、不创建执行事实、不重算评估，也不把预测值或基线当成实际结果。
 */
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  feedbackRefOf,
  responseFeedbackDigest,
  VerifiedResponseWorkflowBindingV1Schema,
  type ResponseLifecycleContextReaderV1,
  type ResponseLifecycleFrozenContextV1,
  type ResponseLifecycleServiceV1,
} from "@riskflow/core/response-lifecycle";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  WarningResponseRecordCommandV1Schema,
  type ActualAssessmentProofPortV1,
  type AuthorizationContextV1,
  type EffectForecastRefV1,
  type HumanDecisionFeedbackCommandV1,
  type HumanDecisionFeedbackPortV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ResponseRecommendationRefV1,
  type ResponseWorkflowBindingProofPortV1,
  type RiskAssessmentRecordRefV1,
  type RouteDecisionRefV1,
  type SpatialScopeRefV1,
  type StartWorkflowRunCommandV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseRecordResultV1,
  type WorkflowPortV1,
  type WorkflowRunCompletionProofPortV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";

import {
  failHumanDecisionFeedback,
  toHumanDecisionFeedbackModuleError,
  type HumanDecisionFeedbackFailureCodeV1,
  type HumanFeedbackInputSnapshotRowV1,
  type HumanFeedbackSnapshotReservationV1,
  type HumanResponseDecisionReservationV1,
  type HumanResponseDecisionV1,
} from "./schema.js";

/** C05 复验接缝：与 C28 同形，逐次命令与读写前复验当前授权。 */
export type HumanDecisionFeedbackAccessV1 = Pick<LocalIdentityAccessV1, "verify">;

/** 下游授权签发请求：只声明分支、精确调用身份与需要复验的空间，不携带正文。 */
export interface HumanDecisionFeedbackAuthorizationRequestV1 {
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
}

export type HumanDecisionFeedbackDownstreamAuthorizerV1 = (
  request: HumanDecisionFeedbackAuthorizationRequestV1,
) => Promise<AuthorizationContextV1>;

/** C41 自有决定占位与终局化：唯一索引由实现方保证，异载荷与并发冲突在此收口（design D3）。 */
export interface HumanResponseDecisionStoreV1 {
  readDecision(input: {
    readonly projectId: string;
    readonly responseRecommendationRef: ResponseRecommendationRefV1;
  }): Promise<HumanResponseDecisionV1 | undefined>;
  reserveAdoption(input: {
    readonly decision: HumanResponseDecisionV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<HumanResponseDecisionReservationV1>;
  declineDecision(input: {
    readonly decision: HumanResponseDecisionV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<HumanResponseDecisionReservationV1>;
  /** 采纳终局化：记录真实 C30 运行与 C28 决定引用；幂等，重放命中同一事实。 */
  commitAdoption(input: {
    readonly projectId: string;
    readonly decisionRef: VersionReference;
    readonly routeDecisionRef: RouteDecisionRefV1;
    readonly forecastRunRef: WorkflowRunRefV1;
    readonly waitStateVersion: string;
    readonly committedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<HumanResponseDecisionV1>;
  /** 恢复完成标记：同一命令身份可安全重试被中断的恢复（design D2）。 */
  markAdoptionResumed(input: {
    readonly projectId: string;
    readonly decisionRef: VersionReference;
    readonly resumedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<void>;
}

/** C41 自有反馈冻结输入：工程 + 命令种类 + 幂等键唯一，正文不可原地修改（design D4）。 */
export interface HumanFeedbackSnapshotStoreV1 {
  readSnapshot(input: {
    readonly projectId: string;
    readonly commandKind: "warning-response.record-feedback";
    readonly idempotencyKey: string;
  }): Promise<HumanFeedbackInputSnapshotRowV1 | undefined>;
  prepareSnapshot(input: {
    readonly row: HumanFeedbackInputSnapshotRowV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<HumanFeedbackSnapshotReservationV1>;
  /** 正式反馈成立后标记冻结行：同键重放命中既有标记，不重复写。 */
  markSnapshotCommitted(input: {
    readonly projectId: string;
    readonly feedbackInputSnapshotRef: { readonly reference: VersionReference };
    readonly committedAt: string;
    /** C28 解析出的真实效果预测：随冻结行一起保存，分段重试据此仍能冻结同一预测。 */
    readonly effectForecastRef?: EffectForecastRefV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<void>;
  /** 反馈分段启动标记：启动失败时保留原身份重试，不重复人工录入（design D4）。 */
  markSegmentStarted(input: {
    readonly projectId: string;
    readonly feedbackInputSnapshotRef: { readonly reference: VersionReference };
    readonly startedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<void>;
}

export interface HumanDecisionFeedbackServicePortsV1 {
  readonly access: HumanDecisionFeedbackAccessV1;
  readonly authorizeDownstream: HumanDecisionFeedbackDownstreamAuthorizerV1;
  readonly decisions: HumanResponseDecisionStoreV1;
  readonly feedbackSnapshots: HumanFeedbackSnapshotStoreV1;
  /** C30 公共写入口：只用于创建等待中的真实运行与按人工决定恢复。 */
  readonly workflow: WorkflowPortV1;
  /** C30 只读证明：按精确建议与运行引用回读已登记事实。 */
  readonly bindingProof: ResponseWorkflowBindingProofPortV1;
  /** C25 只读证明：只按精确评估记录引用核对已成立实际评估。 */
  readonly assessmentProof: ActualAssessmentProofPortV1;
  readonly runCompletionProof: WorkflowRunCompletionProofPortV1;
  /** C28 领域写入：决定、执行与反馈仍由处置模块自己的事务提交。 */
  readonly responseLifecycle: ResponseLifecycleServiceV1;
  /** C28 精确只读上下文：建议链、基线评估与冻结评估依据。 */
  readonly responseContext: ResponseLifecycleContextReaderV1;
  /** 服务端已发布的 C30 入口控制：图版本与冻结重试策略，绝不来自客户端。 */
  readonly workflowStartControl: {
    readonly graphVersion: VersionReference;
    readonly retryPolicyRef: VersionReference;
  };
  readonly now?: () => Date;
}

export interface HumanDecisionFeedbackServiceOptionsV1 {
  readonly ports: HumanDecisionFeedbackServicePortsV1;
}

const ADOPTION_BRANCH_V1 = "warning-response.adopt-recommendation" as const;
const EXECUTION_BRANCH_V1 = "warning-response.record-execution" as const;
const FEEDBACK_BRANCH_V1 = "warning-response.record-feedback" as const;
const ASSESSMENT_READ_BRANCH_V1 = "risk-assessment.read-input-snapshot" as const;

type AdoptRecommendationCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "adopt-recommendation" }
>;
type RecordExecutionCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "record-execution" }
>;
type RecordFeedbackCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "record-feedback" }
>;

interface RefLikeV1 {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

const sameRef = (left: RefLikeV1, right: RefLikeV1): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const refKey = (ref: { readonly kind: string; readonly reference: VersionReference }): string =>
  `${ref.kind}\u0000${ref.reference.entityId}\u0000${ref.reference.versionId}`;

/** 决定身份：由工程、建议精确版本与命令身份确定，原键重放得到同一引用（design D3）。 */
export const decisionRefFor = (input: {
  readonly projectId: string;
  readonly responseRecommendationRef: ResponseRecommendationRefV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly decision: "adopted" | "declined";
  readonly reasonCode: string;
  readonly preActionMonitoringSnapshotRef?: { readonly reference: VersionReference } | undefined;
}): RouteDecisionRefV1 => ({
  kind: "route-decision",
  reference: {
    entityId: `human-response-decision:${input.responseRecommendationRef.reference.entityId}:${input.responseRecommendationRef.reference.versionId}`,
    versionId: sha256CanonicalJson({
      projectId: input.projectId,
      responseRecommendationRef: input.responseRecommendationRef,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      decision: input.decision,
      reasonCode: input.reasonCode,
      preActionMonitoringSnapshotRef: input.preActionMonitoringSnapshotRef?.reference ?? null,
    }),
  },
});

const auditTrailRefFor = (
  commandId: string,
): { readonly kind: "audit-trail" } & {
  readonly reference: VersionReference;
} => ({
  kind: "audit-trail",
  reference: { entityId: `audit-${commandId}:human-decision-feedback`, versionId: "1" },
});

/** 原键重放核对：命令身份或载荷摘要不符即不可覆盖已成立决定（design D3）。 */
const assertSameCommand = (
  decision: HumanResponseDecisionV1,
  commandId: string,
  idempotencyKey: string,
  commandDigest: string,
  actorId: string,
): void => {
  if (
    decision.commandId !== commandId ||
    decision.idempotencyKey !== idempotencyKey ||
    decision.commandDigest !== commandDigest ||
    decision.decidedBy !== actorId
  ) {
    failHumanDecisionFeedback("human-decision-feedback-decision-conflict", "idempotency");
  }
};

export class HumanDecisionFeedbackService implements HumanDecisionFeedbackPortV1 {
  readonly #ports: HumanDecisionFeedbackServicePortsV1;

  constructor(options: HumanDecisionFeedbackServiceOptionsV1) {
    this.#ports = options.ports;
  }

  #nowIso(): string {
    return (this.#ports.now ?? (() => new Date()))().toISOString();
  }

  /** 公开入口：只接受 C41 承载的三个人工命令分支，其它分支明确失败。 */
  async record(command: HumanDecisionFeedbackCommandV1): Promise<WarningResponseRecordResultV1> {
    const causalRunId =
      typeof command === "object" && command !== null && "commandId" in command
        ? String((command as { readonly commandId: unknown }).commandId)
        : "human-decision-feedback.unknown";
    try {
      // 冒充主体或跨工程命令在解析前即按授权失败收口：调用方身份与命令自称不一致时不得
      // 退化成一个泛化技术失败，也不得进入任何业务分支（design D6）。
      const claimed = command as {
        readonly actorId?: unknown;
        readonly projectId?: unknown;
        readonly authorization?: { readonly actorId?: unknown; readonly projectId?: unknown };
      } | null;
      if (
        typeof claimed === "object" &&
        claimed !== null &&
        typeof claimed.actorId === "string" &&
        typeof claimed.projectId === "string" &&
        typeof claimed.authorization === "object" &&
        claimed.authorization !== null &&
        (claimed.actorId !== claimed.authorization.actorId ||
          claimed.projectId !== claimed.authorization.projectId)
      ) {
        failHumanDecisionFeedback(
          "human-decision-feedback-authorization-required",
          "authorization",
        );
      }
      const parsed = WarningResponseRecordCommandV1Schema.safeParse(command);
      if (!parsed.success) {
        failHumanDecisionFeedback(
          "human-decision-feedback-command-unsupported",
          "terminal",
          parsed.error,
        );
      }
      if (parsed.data.kind === "adopt-recommendation") {
        return await this.#adoptRecommendation(parsed.data);
      }
      if (parsed.data.kind === "record-execution") {
        return await this.#recordExecution(parsed.data);
      }
      if (parsed.data.kind === "record-feedback") {
        return await this.#recordFeedback(parsed.data);
      }
      failHumanDecisionFeedback("human-decision-feedback-command-unsupported", "terminal");
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: toHumanDecisionFeedbackModuleError(error, causalRunId, this.#nowIso()),
      };
    }
  }

  // ------------------------------------------------------------------ 授权与下游

  async #verify(
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    },
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(capability)
    ) {
      failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
    }
    const decision = await this.#ports.access
      .verify({
        authorizationContextRef: command.authorization.authorizationContextRef,
        invocationId: command.commandId,
        projectId: command.projectId,
        branch,
        requestedSpatialScopeRefs: [...command.authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: command.authorization.decidedAt,
      })
      .catch((error: unknown): never => {
        if (error instanceof Error && error.name === "AccessServiceError") {
          failHumanDecisionFeedback(
            "human-decision-feedback-authorization-required",
            "authorization",
            error,
          );
        }
        throw error;
      });
    if (decision.context.actorId !== command.actorId) {
      failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
    }
    return decision.context;
  }

  /** 签发窄下游上下文：分支、主体、工程与空间逐项核对，返回不符即关闭失败。 */
  async #issueAuthorization(input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
  }): Promise<AuthorizationContextV1> {
    if (input.requestedSpatialScopeRefs.length === 0) {
      failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
    }
    const context = await this.#ports.authorizeDownstream(input);
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    const requestedKeys = new Set(input.requestedSpatialScopeRefs.map((scope) => refKey(scope)));
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      !context.grantedCapabilities.includes(capability) ||
      context.spatialScopeRefs.length === 0 ||
      context.spatialScopeRefs.some((scope) => !requestedKeys.has(refKey(scope)))
    ) {
      failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
    }
    return context;
  }

  // ------------------------------------------------------------------ 决定

  /** 采纳/拒绝：先按授权读取建议链，再按 D1/D3 决定是否创建等待中的真实预测运行。 */
  async #adoptRecommendation(
    command: AdoptRecommendationCommandV1,
  ): Promise<WarningResponseRecordResultV1> {
    const verified = await this.#verify(command, ADOPTION_BRANCH_V1);
    const recommendationRef = command.payload.responseRecommendationRef;
    const context = await this.#readRecommendation(command, verified, recommendationRef);
    const decisionRef = decisionRefFor({
      projectId: command.projectId,
      responseRecommendationRef: recommendationRef,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      decision: command.payload.decision,
      reasonCode: command.payload.reasonCode,
      preActionMonitoringSnapshotRef: command.payload.preActionMonitoringSnapshotRef,
    });
    const commandDigest = sha256CanonicalJson({
      projectId: command.projectId,
      kind: command.kind,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      actorId: verified.actorId,
      responseRecommendationRef: recommendationRef,
      decision: command.payload.decision,
      reasonCode: command.payload.reasonCode,
      preActionMonitoringSnapshotRef: command.payload.preActionMonitoringSnapshotRef ?? null,
    });
    const existing = await this.#ports.decisions.readDecision({
      projectId: command.projectId,
      responseRecommendationRef: recommendationRef,
    });
    if (existing !== undefined) {
      assertSameCommand(
        existing,
        command.commandId,
        command.idempotencyKey,
        commandDigest,
        verified.actorId,
      );
      if (existing.state === "declined") {
        // 同键同载荷重放的拒绝：返回同一逻辑结果，引用与首次一致（design D1/D3）。
        return {
          kind: "succeeded",
          result: { kind: "decline", routeDecisionRef: existing.decisionRef },
        };
      }
      if (existing.state === "adopted") {
        return await this.#settledOrResume(command, context, existing);
      }
      // 进行中的采纳（同身份被中断）：按原身份继续推进，不重复终局化（design D2）。
      return await this.#continueAdoption(
        command,
        context,
        existing,
        await this.#selectPreActionSnapshot({ command, context }),
      );
    }
    if (command.payload.decision === "declined") {
      const declined = await this.#ports.decisions.declineDecision({
        authorization: verified,
        decision: {
          schemaVersion: "1",
          projectId: command.projectId,
          decisionRef,
          responseRecommendationRef: recommendationRef,
          spatialScopeRef: context.spatialScopeRef,
          state: "declined",
          reasonCode: command.payload.reasonCode,
          decidedBy: verified.actorId,
          decidedAt: command.issuedAt,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          commandDigest,
          auditTrailRef: auditTrailRefFor(command.commandId),
        },
      });
      if (declined.kind === "conflict") {
        failHumanDecisionFeedback(declined.detailCode, "idempotency");
      }
      return {
        kind: "succeeded",
        result: { kind: "decline", routeDecisionRef: declined.decision.decisionRef },
      };
    }
    // 顺序固定：先证明该建议冻结评估输入中的执行前监测快照，再按原键占用 pending 决定。
    const preActionSnapshotRef = await this.#selectPreActionSnapshot({ command, context });
    const reservation = await this.#ports.decisions.reserveAdoption({
      authorization: verified,
      decision: {
        schemaVersion: "1",
        projectId: command.projectId,
        decisionRef,
        responseRecommendationRef: recommendationRef,
        spatialScopeRef: context.spatialScopeRef,
        state: "pending-adoption",
        reasonCode: command.payload.reasonCode,
        decidedBy: verified.actorId,
        decidedAt: command.issuedAt,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandDigest,
        auditTrailRef: auditTrailRefFor(command.commandId),
      },
    });
    if (reservation.kind === "conflict") {
      failHumanDecisionFeedback(reservation.detailCode, "idempotency");
    }
    if (reservation.decision.state === "declined") {
      // 并发中另一主体已提交拒绝：互斥终局不可覆盖。
      failHumanDecisionFeedback("human-decision-feedback-decision-conflict", "business-blocked");
    }
    return await this.#continueAdoption(
      command,
      context,
      reservation.decision,
      preActionSnapshotRef,
    );
  }

  /** 已终局或进行中：`adopted` 直接返回既有事实（恢复未完成时按原身份补齐），`declined` 互斥失败。 */
  async #settledOrResume(
    command: AdoptRecommendationCommandV1,
    context: ResponseLifecycleFrozenContextV1,
    decision: HumanResponseDecisionV1,
  ): Promise<WarningResponseRecordResultV1> {
    if (decision.state !== "adopted") {
      failHumanDecisionFeedback("human-decision-feedback-decision-conflict", "business-blocked");
    }
    const routeDecisionRef = decision.routeDecisionRef;
    const forecastRunRef = decision.forecastRunRef;
    const waitStateVersion = decision.waitStateVersion;
    if (routeDecisionRef === undefined || forecastRunRef === undefined) {
      failHumanDecisionFeedback("human-decision-feedback-decision-conflict", "business-blocked");
    }
    // 恢复只能用终局决定冻结的那份等待点状态版本。历史决定缺该值即无法证明按哪次状态
    // 恢复，按失败闭合收口；不得改用运行登记摘要，也不在此处重新读取运行状态。
    if (waitStateVersion === undefined) {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    if (decision.resumedAt === undefined) {
      const authorization = await this.#issueAuthorization({
        branch: "workflow.resume-run",
        // 必须与 C30 运行时实际使用的调用身份逐字一致：恢复命令身份是
        // `${command.commandId}:resume`，复验按同一身份绑定，签发侧给原始命令 id 会一律拒绝。
        invocationId: `${command.commandId}:resume`,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        requestedSpatialScopeRefs: [context.spatialScopeRef],
      });
      const failed = await this.#resumeForecastRun({
        command,
        context,
        routeDecisionRef,
        forecastRunRef,
        waitStateVersion,
        authorization,
      });
      if (failed !== undefined) return failed;
      await this.#ports.decisions.markAdoptionResumed({
        projectId: command.projectId,
        decisionRef: decision.decisionRef.reference,
        resumedAt: this.#nowIso(),
        authorization,
      });
    }
    return { kind: "succeeded", result: { kind: "adoption", routeDecisionRef, forecastRunRef } };
  }

  /** 采纳主体流程：等待中的真实运行 → C30 精确绑定证明 → C28 决定 → C41 终局 → 恢复。 */
  async #continueAdoption(
    command: AdoptRecommendationCommandV1,
    context: ResponseLifecycleFrozenContextV1,
    decision: HumanResponseDecisionV1,
    preActionSnapshotRef: { readonly kind: "monitoring-snapshot" } & {
      readonly reference: VersionReference;
    },
  ): Promise<WarningResponseRecordResultV1> {
    const recommendationRef = command.payload.responseRecommendationRef;
    const started = await this.#startForecastRun({
      command,
      context,
      preActionSnapshotRef,
      recommendationRef,
    });
    if (started.kind === "failed") return started;
    if (started.kind !== "waiting" || started.workflowRunRef === undefined) {
      // 等待模式必须停留在等待态并带回已登记运行引用：否则不是可冻结的真实绑定（design D2）。
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    // 等待点状态版本是恢复要提交的值，运行登记摘要不是（drift design D-01/D-02）。运行时
    // 交不出时按失败闭合，不以运行引用版本顶替，也不为取得该值再发一次状态读取。
    const waitStateVersion = started.waitStateVersion;
    if (waitStateVersion === undefined) {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    const runRef = started.workflowRunRef;
    const bindingProof = await this.#readBindingProof({
      command,
      context,
      runRef,
      waitStateVersion,
      recommendationRef,
    });
    const binding = VerifiedResponseWorkflowBindingV1Schema.parse({
      schemaVersion: "1",
      projectId: command.projectId,
      responseRecommendationRef: recommendationRef,
      spatialScopeRef: context.spatialScopeRef,
      routeDecisionRef: bindingProof.routeDecisionRef,
      forecastRunRef: runRef,
      waitStateVersion,
      boundAt: this.#nowIso(),
    });
    // C28 按 `command.commandId` + 采纳分支复验这份上下文，所以这里必须交出命令本身已
    // 复验过的那一份：同一调用身份再签一次会与命令级签发构成重放冲突，而且重新签发无法
    // 复述命令级请求的来源集。空间是否覆盖绑定由 C28 的绑定复验判定，不在签发处裁剪。
    const decisionAuthorization = await this.#verify(command, ADOPTION_BRANCH_V1);
    const decided = await this.#ports.responseLifecycle.recordDecision({
      schemaVersion: "1",
      binding,
      command: { ...command, authorization: decisionAuthorization },
    });
    if (decided.kind !== "succeeded") return decided;
    if (decided.result.kind !== "adoption") {
      failHumanDecisionFeedback("human-decision-feedback-contract-drift", "terminal");
    }
    const { routeDecisionRef, forecastRunRef } = decided.result;
    if (!sameRef(routeDecisionRef, binding.routeDecisionRef) || !sameRef(forecastRunRef, runRef)) {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    await this.#ports.decisions.commitAdoption({
      projectId: command.projectId,
      decisionRef: decision.decisionRef.reference,
      routeDecisionRef,
      forecastRunRef,
      waitStateVersion,
      committedAt: this.#nowIso(),
      authorization: decisionAuthorization,
    });
    const resumeAuthorization = await this.#issueAuthorization({
      branch: "workflow.resume-run",
      // 与 `#settledOrResume` 同一约定：签发身份 = C30 恢复命令身份。
      invocationId: `${command.commandId}:resume`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: [context.spatialScopeRef],
    });
    const failed = await this.#resumeForecastRun({
      command,
      context,
      routeDecisionRef,
      forecastRunRef,
      waitStateVersion,
      authorization: resumeAuthorization,
    });
    if (failed !== undefined) return failed;
    await this.#ports.decisions.markAdoptionResumed({
      projectId: command.projectId,
      decisionRef: decision.decisionRef.reference,
      resumedAt: this.#nowIso(),
      authorization: resumeAuthorization,
    });
    return { kind: "succeeded", result: { kind: "adoption", routeDecisionRef, forecastRunRef } };
  }

  /** C30 等待中的真实运行：同键重放命中同一运行，命令身份与人工提交一致（design D2）。 */
  async #startForecastRun(input: {
    readonly command: AdoptRecommendationCommandV1;
    readonly context: ResponseLifecycleFrozenContextV1;
    readonly preActionSnapshotRef: { readonly kind: "monitoring-snapshot" } & {
      readonly reference: VersionReference;
    };
    readonly recommendationRef: ResponseRecommendationRefV1;
  }): Promise<
    | {
        readonly kind: "waiting";
        readonly workflowRunRef?: WorkflowRunRefV1;
        /** 等待点的运行状态版本（drift design D-01）：运行自己算出的事实，调用方不另读。 */
        readonly waitStateVersion?: string;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const authorization = await this.#issueAuthorization({
      branch: "workflow.start-run",
      invocationId: input.command.commandId,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      requestedAt: input.command.issuedAt,
      requestedSpatialScopeRefs: [input.context.spatialScopeRef],
    });
    const payload: StartWorkflowRunCommandV1["payload"] = {
      entryMode: "forecast-response",
      graphVersion: this.#ports.workflowStartControl.graphVersion,
      retryPolicyRef: this.#ports.workflowStartControl.retryPolicyRef,
      adoptedRecommendationRef: input.recommendationRef,
      preActionMonitoringSnapshotRef: input.preActionSnapshotRef,
      assessmentBasisReleaseSetRef: input.context.basisReleaseSetRef,
      frozenAssessmentBasisRef: input.context.baselineAssessmentInputSnapshotRef,
      waitForDecision: true,
    };
    const result = await this.#ports.workflow.startRun({
      kind: "start-run",
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      issuedAt: input.command.issuedAt,
      authorization,
      payload,
    });
    if (result.kind === "failed") return result;
    if (result.kind === "succeeded") {
      // 等待模式必须停留在等待态：已推进的运行不是本次人工决定的绑定，安全失败。
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    return {
      kind: "waiting",
      ...(result.workflowRunRef === undefined ? {} : { workflowRunRef: result.workflowRunRef }),
      ...(result.waitStateVersion === undefined
        ? {}
        : { waitStateVersion: result.waitStateVersion }),
    };
  }

  /** C30 只读证明：逐项核对建议、运行、空间与等待状态，缺一即不为绑定。 */
  async #readBindingProof(input: {
    readonly command: AdoptRecommendationCommandV1;
    readonly context: ResponseLifecycleFrozenContextV1;
    readonly runRef: WorkflowRunRefV1;
    readonly waitStateVersion: string;
    readonly recommendationRef: ResponseRecommendationRefV1;
  }): Promise<{ readonly routeDecisionRef: RouteDecisionRefV1 }> {
    const authorization = await this.#issueAuthorization({
      branch: "workflow.start-run",
      invocationId: `${input.command.commandId}:binding`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      requestedAt: input.command.issuedAt,
      requestedSpatialScopeRefs: [input.context.spatialScopeRef],
    });
    const proof = await this.#ports.bindingProof.verifyResponseWorkflowBinding({
      queryId: `${input.command.commandId}:binding`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      requestedAt: input.command.issuedAt,
      authorization,
      kind: "verify-response-workflow-binding",
      payload: {
        responseRecommendationRef: input.recommendationRef,
        workflowRunRef: input.runRef,
      },
    });
    if (proof.kind !== "succeeded") {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    const bound = proof.result;
    if (
      bound.projectId !== input.command.projectId ||
      !sameRef(bound.responseRecommendationRef, input.recommendationRef) ||
      !sameRef(bound.spatialScopeRef, input.context.spatialScopeRef) ||
      !sameRef(bound.workflowRunRef, input.runRef) ||
      bound.runStatus !== "waiting"
    ) {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    // 归属核对（drift design D-04）：冻结的等待点状态版本必须就是这条运行当前登记的版本。
    // 对不上说明版本属于另一条运行或运行已被推进，按既有失败形态收口，不改按最新继续。
    if (bound.runStateVersion !== input.waitStateVersion) {
      failHumanDecisionFeedback("human-decision-feedback-binding-unavailable", "business-blocked");
    }
    return { routeDecisionRef: bound.routeDecisionRef };
  }

  /** C41 用当前授权恢复等待运行：恢复失败保留正式决定与等待事实，原身份可重试（design D2）。 */
  async #resumeForecastRun(input: {
    readonly command: AdoptRecommendationCommandV1;
    readonly context: ResponseLifecycleFrozenContextV1;
    readonly routeDecisionRef: RouteDecisionRefV1;
    readonly forecastRunRef: WorkflowRunRefV1;
    /** 冻结的等待点运行状态版本：恢复断言提交的就是它（drift design D-05，断言本身不变）。 */
    readonly waitStateVersion: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ readonly kind: "failed"; readonly error: ModuleErrorV1 } | undefined> {
    const resumed = await this.#ports.workflow.resumeRun({
      kind: "resume-run",
      commandId: `${input.command.commandId}:resume`,
      idempotencyKey: `${input.command.idempotencyKey}:resume`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      issuedAt: input.command.issuedAt,
      authorization: input.authorization,
      payload: {
        workflowRunRef: input.forecastRunRef,
        expectedStateVersion: input.waitStateVersion,
        resumeCause: {
          kind: "human-decision-committed",
          routeDecisionRef: input.routeDecisionRef,
        },
      },
    });
    return resumed.kind === "failed" ? resumed : undefined;
  }

  /**
   * 执行前监测快照：只接受该建议冻结评估输入中的候选；调用方未指定时仅唯一候选可用，
   * 多于一个即安全失败，绝不按“最新监测”猜测（design D1）。
   */
  async #selectPreActionSnapshot(input: {
    readonly command: AdoptRecommendationCommandV1;
    readonly context: ResponseLifecycleFrozenContextV1;
  }): Promise<{ readonly kind: "monitoring-snapshot" } & { readonly reference: VersionReference }> {
    const baseline = await this.#readBaselineAssessment(input.command, input.context);
    const candidates = baseline.monitoringSnapshotRefs;
    const provided = input.command.payload.preActionMonitoringSnapshotRef;
    if (provided !== undefined) {
      if (!candidates.some((candidate) => sameRef(candidate, provided))) {
        failHumanDecisionFeedback(
          "human-decision-feedback-pre-action-snapshot-unavailable",
          "business-blocked",
        );
      }
      return provided;
    }
    if (candidates.length !== 1) {
      failHumanDecisionFeedback(
        "human-decision-feedback-pre-action-snapshot-unavailable",
        "business-blocked",
      );
    }
    return candidates[0] as { readonly kind: "monitoring-snapshot" } & {
      readonly reference: VersionReference;
    };
  }

  /** 建议链基线评估的 C25 只读证明：空间、风险输入与冻结输入快照逐项对账。 */
  async #readBaselineAssessment(
    command: AdoptRecommendationCommandV1,
    context: ResponseLifecycleFrozenContextV1,
  ): Promise<{ readonly monitoringSnapshotRefs: readonly RefLikeV1[] }> {
    const authorization = await this.#issueAuthorization({
      branch: ASSESSMENT_READ_BRANCH_V1,
      invocationId: `${command.commandId}:baseline-assessment`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: [context.spatialScopeRef],
    });
    const proof = await this.#ports.assessmentProof.verifyActualAssessment({
      queryId: `${command.commandId}:baseline-assessment`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      authorization,
      kind: "verify-actual-assessment",
      payload: { riskAssessmentRecordRef: context.baselineAssessmentRecordRef },
    });
    if (proof.kind !== "succeeded") {
      failHumanDecisionFeedback(
        "human-decision-feedback-frozen-input-unavailable",
        "business-blocked",
      );
    }
    const baseline = proof.result;
    if (
      baseline.projectId !== command.projectId ||
      !sameRef(baseline.spatialScopeRef, context.spatialScopeRef) ||
      !sameRef(baseline.assessmentInputSnapshotRef, context.baselineAssessmentInputSnapshotRef) ||
      baseline.riskInputRef.kind !== context.riskInputRef.kind ||
      baseline.riskInputRef.reference.entityId !== context.riskInputRef.reference.entityId
    ) {
      failHumanDecisionFeedback(
        "human-decision-feedback-frozen-input-conflict",
        "business-blocked",
      );
    }
    return { monitoringSnapshotRefs: baseline.monitoringSnapshotRefs };
  }

  // ------------------------------------------------------------------ 现场执行

  /**
   * 现场执行：只把人工提交的执行交给 C28 原写路径；采纳来源必须同时与 C41 终局索引对账，
   * 工作流不得代替人提交，也不得用采纳冒充执行（design D3）。
   */
  async #recordExecution(
    command: RecordExecutionCommandV1,
  ): Promise<WarningResponseRecordResultV1> {
    const verified = await this.#verify(command, EXECUTION_BRANCH_V1);
    if (command.payload.actionSource.kind === "adopted-recommendation") {
      const decision = await this.#ports.decisions.readDecision({
        projectId: command.projectId,
        responseRecommendationRef: command.payload.actionSource.responseRecommendationRef,
      });
      if (decision === undefined || decision.state !== "adopted") {
        failHumanDecisionFeedback(
          "human-decision-feedback-decision-not-adopted",
          "business-blocked",
        );
      }
    }
    // 执行记录由 C28 按命令调用身份复验，交出已复验的命令上下文即可：同一调用身份再签
    // 一次会与命令级签发构成重放冲突。采纳来源的空间是否覆盖，由 C28 的执行范围复验判定。
    return await this.#ports.responseLifecycle.recordExecution({
      ...command,
      authorization: verified,
    });
  }

  // ------------------------------------------------------------------ 正式反馈

  /**
   * 正式反馈：冻结输入只在 C25 已成立实际评估与受权依据上创建，
   * 正式事实仍由 C28 自己的事务提交，随后才以精确引用启动反馈分段（design D4）。
   */
  async #recordFeedback(command: RecordFeedbackCommandV1): Promise<WarningResponseRecordResultV1> {
    const verified = await this.#verify(command, FEEDBACK_BRANCH_V1);
    const selector = command.payload.actualAssessmentRecordRef;
    if (selector === undefined) {
      // 正式提交必须提供精确选择器：缺失即失败，绝不回退到基线或“最新”评估。
      failHumanDecisionFeedback(
        "human-decision-feedback-actual-assessment-required",
        "business-blocked",
      );
    }
    const authorization = verified;
    const assessment = await this.#readActualAssessment(command, selector, verified);
    const inputDigest = sha256CanonicalJson({
      feedback: responseFeedbackDigest({
        projectId: command.projectId,
        executionRecordRef: command.payload.executionRecordRef.reference,
        postActionMonitoringSnapshotRef: command.payload.postActionMonitoringSnapshotRef.reference,
        feedbackArtifactRef: command.payload.feedbackArtifactRef.reference,
        actualAssessmentRecordRef: selector.reference,
        occurredAt: command.payload.occurredAt,
      }),
      commandKind: command.kind,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
    });
    const feedbackRef = feedbackRefOf(inputDigest);
    const prepared = await this.#ports.feedbackSnapshots.prepareSnapshot({
      authorization,
      row: {
        schemaVersion: "1",
        projectId: command.projectId,
        feedbackInputSnapshotRef: {
          kind: "response-feedback-input-snapshot",
          reference: {
            entityId: `response-feedback-input:${command.projectId}:${inputDigest.slice(0, 32)}`,
            versionId: inputDigest,
          },
        },
        commandKind: "warning-response.record-feedback",
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        inputDigest,
        snapshot: {
          schemaVersion: "1",
          executionRecordRef: command.payload.executionRecordRef,
          feedbackRef,
          deviationPolicyRef: assessment.deviationPolicyRef,
          calibrationAgentPolicyRef: assessment.calibrationAgentPolicyRef,
          authorizationContextRef: authorization.authorizationContextRef,
          auditTrailRef: auditTrailRefFor(command.commandId),
          createdBy: command.actorId,
          createdAt: command.issuedAt,
        },
        spatialScopeRef: assessment.spatialScopeRef,
        actualAssessmentRecordRef: selector,
        executionRecordRef: command.payload.executionRecordRef,
        state: "prepared",
        preparedAt: this.#nowIso(),
        auditTrailRef: auditTrailRefFor(command.commandId),
      },
    });
    if (prepared.kind === "conflict") {
      failHumanDecisionFeedback(prepared.detailCode, "idempotency");
    }
    const frozen = prepared.row;
    // 分段冻结的预测以冻结行为准：首次由 C28 交出并随提交落库，重放只读冻结行，
    // 两次启动因此冻结同一预测，不会因重试改判偏差支路。
    let effectForecastRef = frozen.effectForecastRef;
    if (frozen.state === "prepared") {
      const recorded = await this.#ports.responseLifecycle.recordFeedback({
        schemaVersion: "1",
        command: { ...command, authorization },
        feedbackInputSnapshotRef: frozen.feedbackInputSnapshotRef,
        feedbackInputSnapshot: {
          // 冻结正文原样提交，只有本次命令身份对应的授权上下文引用随调用更新：
          // C28 只接受同一命令授权的冻结输入，业务字段一律取自不可变冻结行。
          ...frozen.snapshot,
          authorizationContextRef: authorization.authorizationContextRef,
        },
        actualAssessmentRecordRef: frozen.actualAssessmentRecordRef,
      });
      if (recorded.kind !== "succeeded") return recorded;
      if (
        recorded.result.kind !== "feedback" ||
        !sameRef(recorded.result.feedbackRef, feedbackRef)
      ) {
        failHumanDecisionFeedback("human-decision-feedback-contract-drift", "terminal");
      }
      effectForecastRef = recorded.result.effectForecastRef;
      await this.#ports.feedbackSnapshots.markSnapshotCommitted({
        projectId: command.projectId,
        feedbackInputSnapshotRef: frozen.feedbackInputSnapshotRef,
        committedAt: this.#nowIso(),
        ...(effectForecastRef === undefined ? {} : { effectForecastRef }),
        authorization,
      });
    }
    if (frozen.segmentStartedAt === undefined) {
      const failed = await this.#startFeedbackSegment({
        command,
        frozen,
        assessment,
        ...(effectForecastRef === undefined ? {} : { effectForecastRef }),
      });
      if (failed !== undefined) return failed;
      await this.#ports.feedbackSnapshots.markSegmentStarted({
        projectId: command.projectId,
        feedbackInputSnapshotRef: frozen.feedbackInputSnapshotRef,
        startedAt: this.#nowIso(),
        authorization,
      });
    }
    return { kind: "succeeded", result: { kind: "feedback", feedbackRef } };
  }

  /** C25 精确证明：同工程、空间、风险输入与冻结依据逐项对账，不以调用方自述代替。 */
  async #readActualAssessment(
    command: RecordFeedbackCommandV1,
    selector: RiskAssessmentRecordRefV1,
    verified: AuthorizationContextV1,
  ): Promise<{
    readonly deviationPolicyRef: VersionReference;
    readonly calibrationAgentPolicyRef: VersionReference;
    readonly spatialScopeRef: SpatialScopeRefV1;
    readonly assessmentBasisReleaseSetRef: {
      readonly kind: "assessment-basis-release-set";
      readonly reference: VersionReference;
    };
    readonly assessmentInputSnapshotRef: {
      readonly kind: "assessment-input-snapshot";
      readonly reference: VersionReference;
    };
  }> {
    const authorization = await this.#issueAuthorization({
      branch: ASSESSMENT_READ_BRANCH_V1,
      invocationId: `${command.commandId}:actual-assessment`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: verified.spatialScopeRefs,
    });
    const proof = await this.#ports.assessmentProof.verifyActualAssessment({
      queryId: `${command.commandId}:actual-assessment`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      authorization,
      kind: "verify-actual-assessment",
      payload: { riskAssessmentRecordRef: selector },
    });
    if (proof.kind !== "succeeded") {
      failHumanDecisionFeedback(
        "human-decision-feedback-actual-assessment-mismatch",
        "business-blocked",
      );
    }
    const established = proof.result;
    if (
      established.projectId !== command.projectId ||
      !sameRef(established.riskAssessmentRecordRef, selector)
    ) {
      failHumanDecisionFeedback(
        "human-decision-feedback-actual-assessment-mismatch",
        "business-blocked",
      );
    }
    const runAuthorization = await this.#issueAuthorization({
      branch: "workflow.start-run",
      invocationId: `${command.commandId}:assessment-run`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: [established.spatialScopeRef],
    });
    const completed = await this.#ports.runCompletionProof.verifyWorkflowRunCompletion({
      kind: "verify-workflow-run-completion",
      queryId: `${command.commandId}:assessment-run`,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      authorization: runAuthorization,
      payload: {
        workflowRunRef: established.assessmentRunRef,
        riskAssessmentRecordRef: selector,
      },
    });
    if (
      completed.kind !== "succeeded" ||
      completed.result.projectId !== command.projectId ||
      !sameRef(completed.result.workflowRunRef, established.assessmentRunRef) ||
      !sameRef(completed.result.riskAssessmentRecordRef, selector)
    ) {
      failHumanDecisionFeedback(
        "human-decision-feedback-actual-assessment-mismatch",
        "business-blocked",
      );
    }
    return {
      deviationPolicyRef: established.deviationPolicyRef,
      calibrationAgentPolicyRef: established.calibrationAgentPolicyRef,
      spatialScopeRef: established.spatialScopeRef,
      assessmentBasisReleaseSetRef: established.assessmentBasisReleaseSetRef,
      assessmentInputSnapshotRef: established.assessmentInputSnapshotRef,
    };
  }

  /** 正式反馈之后才启动精确分段：只读该反馈引用与冻结依据，不重做人工录入（design D4）。 */
  async #startFeedbackSegment(input: {
    readonly command: RecordFeedbackCommandV1;
    readonly frozen: HumanFeedbackInputSnapshotRowV1;
    readonly assessment: {
      readonly spatialScopeRef: SpatialScopeRefV1;
      readonly assessmentBasisReleaseSetRef: {
        readonly kind: "assessment-basis-release-set";
        readonly reference: VersionReference;
      };
      readonly assessmentInputSnapshotRef: {
        readonly kind: "assessment-input-snapshot";
        readonly reference: VersionReference;
      };
    };
    /** C28 解析出的真实效果预测：冻结进分段入口，A2/A3 据此核对偏差并驱动校准。 */
    readonly effectForecastRef?: EffectForecastRefV1;
  }): Promise<{ readonly kind: "failed"; readonly error: ModuleErrorV1 } | undefined> {
    const authorization = await this.#issueAuthorization({
      branch: "workflow.start-run",
      // 必须与 C30 运行时实际使用的调用身份逐字一致：分段启动命令身份是
      // `${command.commandId}:feedback-segment`，复验按同一身份绑定，签发侧给原始命令 id 会一律拒绝。
      invocationId: `${input.command.commandId}:feedback-segment`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      requestedAt: input.command.issuedAt,
      requestedSpatialScopeRefs: [input.assessment.spatialScopeRef],
    });
    const result = await this.#ports.workflow.startRun({
      kind: "start-run",
      commandId: `${input.command.commandId}:feedback-segment`,
      idempotencyKey: `${input.command.idempotencyKey}:feedback-segment`,
      projectId: input.command.projectId,
      actorId: input.command.actorId,
      issuedAt: input.command.issuedAt,
      authorization,
      payload: {
        entryMode: "record-response-feedback",
        graphVersion: this.#ports.workflowStartControl.graphVersion,
        retryPolicyRef: this.#ports.workflowStartControl.retryPolicyRef,
        executionRecordRef: input.frozen.executionRecordRef,
        feedbackRef: input.frozen.snapshot.feedbackRef,
        assessmentBasisReleaseSetRef: input.assessment.assessmentBasisReleaseSetRef,
        frozenAssessmentBasisRef: input.assessment.assessmentInputSnapshotRef,
        // 预测不可用时不带该字段：分段按既有 `effect-forecast-missing` 语义跳过支路，不补造预测。
        ...(input.effectForecastRef === undefined ? {} : { forecastRef: input.effectForecastRef }),
      },
    });
    return result.kind === "failed" ? result : undefined;
  }

  // ------------------------------------------------------------------ 读取

  async #readRecommendation(
    command: AdoptRecommendationCommandV1,
    verified: AuthorizationContextV1,
    recommendationRef: ResponseRecommendationRefV1,
  ): Promise<ResponseLifecycleFrozenContextV1> {
    return await this.#ports.responseContext
      .readRecommendationContext({
        requestId: command.commandId,
        requestedAt: command.issuedAt,
        authorization: verified,
        responseRecommendationRef: recommendationRef,
      })
      .catch((error: unknown): never => {
        failHumanDecisionFeedback(
          "human-decision-feedback-frozen-input-unavailable",
          "business-blocked",
          error,
        );
      });
  }
}

export { type HumanDecisionFeedbackFailureCodeV1 };
