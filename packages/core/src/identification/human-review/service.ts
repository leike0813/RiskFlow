import type { VersionReference } from "@riskflow/contracts/common";
import {
  ModuleErrorV1Schema,
  ReviewDecisionCommandV1Schema,
  type ContractReferenceV1,
  type IdentificationCandidateSetRefV1,
  type IdentificationGroupRefV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type ReviewDecisionV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";

import type { IdentificationReviewRevisionOutcomeV1 } from "../candidate-finalization/ports.js";

import {
  IDENTIFICATION_HUMAN_REVIEW_STAGE_PREFIX_V1,
  IdentificationHumanReviewBatchResultV1Schema,
  IdentificationHumanReviewBatchV1Schema,
  IdentificationHumanReviewCommandV1Schema,
  IdentificationHumanReviewResultV1Schema,
  type IdentificationHumanReviewBatchItemResultV1,
  type IdentificationHumanReviewBatchResultV1,
  type IdentificationHumanReviewBatchV1,
  type IdentificationHumanReviewCommandV1,
  type IdentificationHumanReviewDecisionV1,
  type IdentificationHumanReviewResultV1,
} from "./schema.js";
import type { IdentificationHumanReviewServiceOptionsV1 } from "./ports.js";

const STAGE_PREFIX = IDENTIFICATION_HUMAN_REVIEW_STAGE_PREFIX_V1;
const CAPABILITY: ModuleCapabilityV1 = "review-audit.decide";

const diagnosticRef = (stage: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: { entityId: `${STAGE_PREFIX}-${stage}`, versionId: "v1" },
});

const unsupportedContract = (stage: string, occurredAt: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.${stage}`,
    occurredAt,
    causalRunId: stage,
    code: "UNSUPPORTED_CONTRACT",
    category: "technical",
    retryable: false,
    schemaVersion: "1",
  });

const authorizationDenied = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly policyRef: VersionReference;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.authorization`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: CAPABILITY,
    authorizationPolicyRef: input.policyRef,
  });

const staleVersion = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly targetRef: ContractReferenceV1;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.stale-version`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "STALE_VERSION",
    category: "concurrency",
    retryable: false,
    targetRef: input.targetRef,
  });

const businessBlocked = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly blockerKind: string;
  readonly blockerRef: ContractReferenceV1;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.${input.blockerKind}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind: input.blockerKind,
    blockerRef: input.blockerRef,
  });

const idempotencyConflict = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly priorCommandId: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.idempotency`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "IDEMPOTENCY_CONFLICT",
    category: "idempotency",
    retryable: false,
    idempotencyKey: input.idempotencyKey,
    priorCommandId: input.priorCommandId,
  });

const terminalFailure = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly stage: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.${input.stage}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: diagnosticRef(input.stage),
  });

/**
 * 复核决定映射（design D-06）：只从私有决定构造 C02 已有决定；修订分支的决定引用由 C22 返回的
 * 新候选集承载，C23 不自行合成候选内容，也不发明近义决定。
 */
const publicDecisionFor = (
  decision: IdentificationHumanReviewDecisionV1,
  revisedCandidateSetRef: IdentificationCandidateSetRefV1 | undefined,
): ReviewDecisionV1 => {
  switch (decision.kind) {
    case "approve-revised-candidate": {
      if (revisedCandidateSetRef === undefined) {
        throw new TypeError("revised candidate set reference is required");
      }
      return {
        reviewType: "identification-group",
        kind: "approve-revised-candidate",
        revisedCandidateRef: revisedCandidateSetRef,
      };
    }
    case "approve-unchanged":
      return { reviewType: "identification-group", kind: "approve-unchanged" };
    case "confirm-merge":
      return { reviewType: "identification-group", kind: "confirm-merge" };
    case "keep-separate":
      return { reviewType: "identification-group", kind: "keep-separate" };
    case "reject":
      return { reviewType: "identification-group", kind: "reject" };
    case "return-upstream":
      return { reviewType: "identification-group", kind: "return-upstream" };
  }
};

/**
 * 识别人工复核深模块（design D-01/D-02/D-06/D-07）：只组合 C07 授权先行的待处理任务窄读、
 * C22 候选修订接缝与 C07 决定公共分支。六类决定最终只提交一次标准 `decideReview`，因此授权、
 * 幂等、逐项事务、审计与 `review.review-resolved.v1` 恢复信号全部由 C07 原子成立；C23 不实现
 * 平行工作流状态机，也不在批量中建立跨任务事务，也不直接调用 workflow resume。
 */
export class IdentificationHumanReviewService {
  readonly #options: IdentificationHumanReviewServiceOptionsV1;
  readonly #now: () => Date;

  constructor(options: IdentificationHumanReviewServiceOptionsV1) {
    const required: readonly (keyof IdentificationHumanReviewServiceOptionsV1)[] = [
      "pendingReviewReader",
      "reviewRevision",
      "review",
    ];
    for (const key of required) {
      if (options[key] === undefined) {
        throw new TypeError(`identification human review requires dependency ${key}`);
      }
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async decide(
    command: IdentificationHumanReviewCommandV1,
  ): Promise<IdentificationHumanReviewResultV1> {
    const parsed = IdentificationHumanReviewCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return IdentificationHumanReviewResultV1Schema.parse({
        kind: "failed",
        error: unsupportedContract(
          "identification-human-review-command",
          this.#now().toISOString(),
        ),
      });
    }
    return this.#decideValid(parsed.data);
  }

  async decideBatch(
    batch: IdentificationHumanReviewBatchV1,
  ): Promise<IdentificationHumanReviewBatchResultV1> {
    const parsed = IdentificationHumanReviewBatchV1Schema.safeParse(batch);
    if (!parsed.success) {
      // 结构非法、超限或重复任务引用在执行任何一项之前整体拒绝（design D-07）。
      return IdentificationHumanReviewBatchResultV1Schema.parse({
        kind: "failed",
        error: unsupportedContract("identification-human-review-batch", this.#now().toISOString()),
      });
    }
    const results: IdentificationHumanReviewBatchItemResultV1[] = [];
    for (const item of parsed.data.items) {
      const result = await this.decide(item);
      results.push(
        result.kind === "succeeded"
          ? { kind: "succeeded", reviewTaskRef: item.reviewTaskRef, result: result.result }
          : { kind: "failed", reviewTaskRef: item.reviewTaskRef, error: result.error },
      );
    }
    return IdentificationHumanReviewBatchResultV1Schema.parse({ kind: "succeeded", results });
  }

  #fail(error: ModuleErrorV1): IdentificationHumanReviewResultV1 {
    return IdentificationHumanReviewResultV1Schema.parse({ kind: "failed", error });
  }

  async #decideValid(
    command: IdentificationHumanReviewCommandV1,
  ): Promise<IdentificationHumanReviewResultV1> {
    const occurredAt = this.#now().toISOString();
    const causalRunId = command.reviewTaskRef.waitingRunRef.reference.entityId;
    const read = await this.#options.pendingReviewReader.readPendingIdentificationReview({
      projectId: command.projectId,
      reviewTaskRef: command.reviewTaskRef,
      authorization: command.authorization,
      idempotencyKey: command.idempotencyKey,
      invocationId: command.commandId,
      requestedAt: command.issuedAt,
    });
    if (read.kind === "blocked") {
      return this.#fail(
        this.#readFailure(read.detailCode, command.reviewTaskRef, command, occurredAt, causalRunId),
      );
    }
    // `decided` 与 `pending` 走同一路径：修订接缝与 C07 决定都按命令身份幂等，
    // 因此同命令重放返回原候选/校验/决定引用，而不同命令只会在 C07 得到稳定陈旧结果。
    const task = read.task;

    let revision:
      Extract<IdentificationReviewRevisionOutcomeV1, { readonly kind: "revised" }> | undefined;
    if (command.decision.kind === "approve-revised-candidate") {
      // 修订阶段身份由外层决定命令派生：同载荷重试复用既有工件与登记，异载荷返回幂等冲突。
      const outcome = await this.#options.reviewRevision.prepareReviewRevision({
        projectId: command.projectId,
        actorId: command.actorId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt,
        invocationId: `${command.commandId}:revision`,
        authorization: command.authorization,
        groupRef: task.groupRef,
        validationSnapshotRef: task.validationSnapshotRef,
        evidenceSnapshotRef: task.evidenceSnapshotRef,
        sourceCandidateSetRef: command.decision.revision.sourceCandidateSetRef,
        sourceValidatedCandidateSetRef: command.decision.revision.sourceValidatedCandidateSetRef,
        candidateRef: command.decision.revision.candidateRef,
        changes: command.decision.revision.changes,
      });
      if (outcome.kind !== "revised") {
        return this.#fail(
          this.#revisionFailure(outcome, command, task.groupRef, occurredAt, causalRunId),
        );
      }
      revision = outcome;
    }

    const decisionCommand = ReviewDecisionCommandV1Schema.safeParse({
      kind: "decide-review",
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization: command.authorization,
      payload: {
        reviewTaskRef: task.reviewTaskRef,
        targetRef: task.groupRef,
        decision: publicDecisionFor(
          command.decision,
          revision === undefined ? undefined : revision.revisedCandidateSetRef,
        ),
        reasonCode: command.reasonCode,
      },
    });
    if (!decisionCommand.success) {
      return this.#fail(unsupportedContract("identification-human-review-decision", occurredAt));
    }
    const decided = await this.#options.review.decideReview(decisionCommand.data);
    if (decided.kind === "failed") {
      // C07 的授权、陈旧、幂等与技术错误原样映射，不重新解释为业务复核结果。
      return this.#fail(decided.error);
    }
    if (decided.kind !== "succeeded") {
      return this.#fail(
        terminalFailure({ causalRunId, occurredAt, stage: "decide-review-outcome" }),
      );
    }
    return IdentificationHumanReviewResultV1Schema.parse({
      kind: "succeeded",
      result:
        revision === undefined
          ? {
              outcomeKind: "decided",
              reviewDecisionRef: decided.result.reviewDecisionRef,
              waitingRunRef: task.waitingRunRef,
            }
          : {
              outcomeKind: "revised",
              reviewDecisionRef: decided.result.reviewDecisionRef,
              waitingRunRef: task.waitingRunRef,
              revisedCandidateSetRef: revision.revisedCandidateSetRef,
              validatedCandidateSetRef: revision.validatedCandidateSetRef,
            },
    });
  }

  /**
   * 窄读失败的稳定映射（design D-09）：无权与不可枚举的读取失败都不暴露目标存在性，
   * 陈旧任务/目标返回 `STALE_VERSION`，其余读取故障返回技术错误。
   */
  #readFailure(
    detailCode: string,
    reviewTaskRef: ReviewTaskRefV1,
    command: IdentificationHumanReviewCommandV1,
    occurredAt: string,
    causalRunId: string,
  ): ModuleErrorV1 {
    if (detailCode === "review-task-not-authorized") {
      return authorizationDenied({
        causalRunId,
        occurredAt,
        policyRef: command.authorization.authorizationPolicyRef,
      });
    }
    if (detailCode === "review-task-unavailable") {
      return terminalFailure({ causalRunId, occurredAt, stage: "pending-review-read" });
    }
    return staleVersion({ causalRunId, occurredAt, targetRef: reviewTaskRef });
  }

  #revisionFailure(
    outcome: Exclude<IdentificationReviewRevisionOutcomeV1, { readonly kind: "revised" }>,
    command: IdentificationHumanReviewCommandV1,
    groupRef: IdentificationGroupRefV1,
    occurredAt: string,
    causalRunId: string,
  ): ModuleErrorV1 {
    switch (outcome.kind) {
      case "unauthorized":
        return authorizationDenied({
          causalRunId,
          occurredAt,
          policyRef: command.authorization.authorizationPolicyRef,
        });
      case "stale":
        return staleVersion({ causalRunId, occurredAt, targetRef: groupRef });
      case "blocked":
        return businessBlocked({
          causalRunId,
          occurredAt,
          blockerKind: outcome.detailCode,
          blockerRef: groupRef,
        });
      case "conflict":
        return idempotencyConflict({
          causalRunId,
          occurredAt,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: outcome.priorCommandId,
        });
      case "failed":
        return terminalFailure({ causalRunId, occurredAt, stage: outcome.detailCode });
    }
  }
}

export const createIdentificationHumanReviewService = (
  options: IdentificationHumanReviewServiceOptionsV1,
): IdentificationHumanReviewService => new IdentificationHumanReviewService(options);
