/**
 * C23 识别人工复核核心行为测试（IP-01/IP-04/IP-05/IP-07）：私有 Schema 边界、六类单项决定
 * 映射、修订分支的任务冻结引用传递、C07 错误原样映射、批量逐项隔离与结构预检。
 *
 * 全部 fixture 均为「合成样本、待甲方复核」：任务、分组、候选集、快照与决定都是手工构造的
 * 合成值，不对应任何真实工程资料、真实分组或真实模型输出。
 *
 * 断言只覆盖稳定可观察行为：决定 kind/引用、稳定错误码、端口调用计数与零副作用。不断言
 * 完整错误文案、内部调用顺序或 Schema 源码。
 */
import { describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type IdentificationCandidateSetRefV1,
  type IdentificationGroupRefV1,
  type ReviewDecisionCommandV1,
  type ReviewDecisionResultV1,
  type ReviewTaskRefV1,
  type ValidatedCandidateSetRefV1,
} from "@riskflow/contracts/ports";

import {
  IdentificationHumanReviewBatchV1Schema,
  IdentificationHumanReviewCommandV1Schema,
  IdentificationHumanReviewService,
  IdentificationReviewRevisionV1Schema,
  type IdentificationHumanReviewBatchV1,
  type IdentificationHumanReviewCommandV1,
  type IdentificationHumanReviewResultV1,
  type IdentificationPendingReviewReadV1,
  type IdentificationPendingReviewReaderV1,
  type IdentificationReviewRevisionPortV1,
} from "../../src/identification/human-review/index.js";
import type { IdentificationHumanReviewServiceOptionsV1 } from "../../src/identification/human-review/ports.js";

const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const PROJECT = "project-c23";
const ACTOR = "actor-c23";

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});

const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context-c23"),
};
const groupRef: IdentificationGroupRefV1 = {
  kind: "identification-group",
  reference: versionRef(`identification-group:${PROJECT}:work-plan-c23:group-1`, "digest-group"),
};
const waitingRunRef = {
  kind: "workflow-run" as const,
  reference: versionRef(`identification-run:${PROJECT}:work-plan-c23`),
};
const reviewTaskRef: ReviewTaskRefV1 = {
  kind: "review-task",
  reference: versionRef(`identification-group-review:${PROJECT}:digest-group`, "v1"),
  reviewType: "identification-group",
  targetRef: groupRef,
  waitingRunRef,
};
const validationSnapshotRef = {
  kind: "validation-snapshot" as const,
  reference: versionRef(`validation-snapshot:${PROJECT}:group-1`, "digest-group"),
};
const evidenceSnapshotRef = {
  kind: "evidence-snapshot" as const,
  reference: versionRef(`evidence-snapshot:${PROJECT}:group-1`, "digest-group"),
};
const sourceCandidateSetRef: IdentificationCandidateSetRefV1 = {
  kind: "identification-candidate-set",
  reference: versionRef(`identification-candidate-set:${PROJECT}:work-item-c23`, "digest-set"),
};
const sourceValidatedCandidateSetRef: ValidatedCandidateSetRefV1 = {
  kind: "validated-candidate-set",
  reference: versionRef(`validated-candidate-set:${PROJECT}:work-item-c23`, "digest-validation"),
};
const candidateRef = {
  kind: "content-artifact" as const,
  reference: versionRef("candidate-artifact-candidate-001-v1", "sha256:candidate"),
};
const revisedCandidateSetRef: IdentificationCandidateSetRefV1 = {
  kind: "identification-candidate-set",
  reference: versionRef(`identification-candidate-set:${PROJECT}:work-item-c23`, "digest-revised"),
};
const validatedCandidateSetRef: ValidatedCandidateSetRefV1 = {
  kind: "validated-candidate-set",
  reference: versionRef(
    `validated-candidate-set:${PROJECT}:work-item-c23`,
    "digest-revised-validation",
  ),
};
const reviewDecisionRef = {
  kind: "review-decision" as const,
  reference: versionRef("review-decision-1"),
};

const authorization = (): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef,
  actorId: ACTOR,
  projectId: PROJECT,
  grantedCapabilities: ["review-audit.decide"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: versionRef("access-policy"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

const pendingTask = (): Extract<
  IdentificationPendingReviewReadV1,
  { kind: "pending" }
>["task"] => ({
  reviewTaskRef,
  groupRef,
  validationSnapshotRef,
  evidenceSnapshotRef,
  reviewPolicyRef: versionRef("review-policy"),
  waitingRunRef,
});

const revisionBody = () => ({
  sourceCandidateSetRef,
  sourceValidatedCandidateSetRef,
  candidateRef,
  changes: { riskEvent: "掌子面失稳涌水（复核修正）" },
});

const rawCommand = (
  decision: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  commandId: "command-c23",
  idempotencyKey: "idempotency-c23",
  projectId: PROJECT,
  actorId: ACTOR,
  issuedAt: TIMESTAMP,
  authorization: authorization(),
  reviewTaskRef,
  reasonCode: "review-complete",
  decision: { reviewType: "identification-group", ...decision },
  ...overrides,
});

const commandFor = (
  decision: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): IdentificationHumanReviewCommandV1 =>
  IdentificationHumanReviewCommandV1Schema.parse(rawCommand(decision, overrides));

interface HarnessOverrides {
  readonly pendingRead?: IdentificationPendingReviewReadV1;
  readonly revisionOutcome?: unknown;
  readonly decisionResult?: ReviewDecisionResultV1;
}

const makeHarness = (overrides: HarnessOverrides = {}) => {
  const calls = { pendingReads: 0, revisions: 0, decisions: 0 };
  const revisionInputs: unknown[] = [];
  const decisionCommands: ReviewDecisionCommandV1[] = [];
  const pendingReviewReader: IdentificationPendingReviewReaderV1 = {
    async readPendingIdentificationReview() {
      calls.pendingReads += 1;
      return overrides.pendingRead ?? { kind: "pending", task: pendingTask() };
    },
  };
  const reviewRevision: IdentificationReviewRevisionPortV1 = {
    async prepareReviewRevision(input) {
      calls.revisions += 1;
      revisionInputs.push(input);
      return (overrides.revisionOutcome ?? {
        kind: "revised",
        revisedCandidateSetRef,
        validatedCandidateSetRef,
      }) as never;
    },
  };
  const review = {
    async decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1> {
      calls.decisions += 1;
      decisionCommands.push(command);
      return (
        overrides.decisionResult ?? {
          kind: "succeeded",
          result: { reviewDecisionRef },
        }
      );
    },
  };
  const options = {
    pendingReviewReader,
    reviewRevision,
    review,
    now: () => new Date(TIMESTAMP),
  } as IdentificationHumanReviewServiceOptionsV1;
  return {
    service: new IdentificationHumanReviewService(options),
    calls,
    revisionInputs,
    decisionCommands,
  };
};

const failedError = (result: IdentificationHumanReviewResultV1) =>
  result.kind === "failed" ? result.error : undefined;

const lastDecision = (commands: readonly ReviewDecisionCommandV1[]) => {
  const command = commands.at(-1);
  if (command === undefined) throw new Error("no review decision was submitted");
  return command.payload.decision;
};

// ============================================================ 单项决定与修订接线

describe("C23 单项复核决定", () => {
  it.each([
    ["approve-unchanged"],
    ["confirm-merge"],
    ["keep-separate"],
    ["reject"],
    ["return-upstream"],
  ] as const)("把 %s 映射为同名 identification-group 决定", async (kind) => {
    const harness = makeHarness();
    const result = await harness.service.decide(commandFor({ kind }));

    expect(result).toEqual({
      kind: "succeeded",
      result: { outcomeKind: "decided", reviewDecisionRef, waitingRunRef },
    });
    expect(lastDecision(harness.decisionCommands)).toEqual({
      reviewType: "identification-group",
      kind,
    });
    expect(harness.calls).toEqual({ pendingReads: 1, revisions: 0, decisions: 1 });
  });

  it("修订并通过先取冻结来源修订，再以新候选集提交决定", async () => {
    const harness = makeHarness();
    const result = await harness.service.decide(
      commandFor({ kind: "approve-revised-candidate", revision: revisionBody() }),
    );

    expect(result).toEqual({
      kind: "succeeded",
      result: {
        outcomeKind: "revised",
        reviewDecisionRef,
        waitingRunRef,
        revisedCandidateSetRef,
        validatedCandidateSetRef,
      },
    });
    expect(lastDecision(harness.decisionCommands)).toEqual({
      reviewType: "identification-group",
      kind: "approve-revised-candidate",
      revisedCandidateRef: revisedCandidateSetRef,
    });
    const revisionInput = harness.revisionInputs[0] as Record<string, unknown>;
    expect(revisionInput.groupRef).toEqual(groupRef);
    expect(revisionInput.validationSnapshotRef).toEqual(validationSnapshotRef);
    expect(revisionInput.evidenceSnapshotRef).toEqual(evidenceSnapshotRef);
    expect(revisionInput.candidateRef).toEqual(candidateRef);
    expect(Object.keys(revisionInput)).not.toContain("waitingRunRef");
    expect(harness.calls).toEqual({ pendingReads: 1, revisions: 1, decisions: 1 });
  });

  it("已决定任务以同命令重试时返回原候选、校验与决定引用", async () => {
    const harness = makeHarness({
      pendingRead: { kind: "decided", task: pendingTask() },
    });
    const result = await harness.service.decide(
      commandFor({ kind: "approve-revised-candidate", revision: revisionBody() }),
    );

    // 修订接缝与 C07 决定都按命令身份幂等：重试返回原引用，不产生新版本或第二条决定。
    expect(result).toEqual({
      kind: "succeeded",
      result: {
        outcomeKind: "revised",
        reviewDecisionRef,
        waitingRunRef,
        revisedCandidateSetRef,
        validatedCandidateSetRef,
      },
    });
    expect(harness.calls).toEqual({ pendingReads: 1, revisions: 1, decisions: 1 });
  });

  it("C07 失败原样映射，不解释为业务复核结果", async () => {
    const c07Error = ModuleErrorV1Schema.parse({
      stageCode: "review-audit.stale_version",
      occurredAt: TIMESTAMP,
      causalRunId: waitingRunRef.reference.entityId,
      code: "STALE_VERSION",
      category: "concurrency",
      retryable: false,
      targetRef: reviewTaskRef,
    });
    const harness = makeHarness({ decisionResult: { kind: "failed", error: c07Error } });
    const result = await harness.service.decide(commandFor({ kind: "approve-unchanged" }));

    expect(failedError(result)).toEqual(c07Error);
  });

  it.each([
    ["review-task-stale", "STALE_VERSION"],
    ["review-task-not-found", "STALE_VERSION"],
    ["review-task-fact-mismatch", "STALE_VERSION"],
    ["review-task-not-authorized", "AUTHORIZATION_DENIED"],
    ["review-task-unavailable", "TERMINAL_FAILURE"],
  ] as const)("把待处理任务窄读失败 %s 映射为 %s 且不提交决定", async (detailCode, code) => {
    const harness = makeHarness({ pendingRead: { kind: "blocked", detailCode } });
    const result = await harness.service.decide(commandFor({ kind: "reject" }));
    const error = failedError(result);

    expect(error?.code).toBe(code);
    expect(harness.calls.decisions).toBe(0);
    if (code === "AUTHORIZATION_DENIED") {
      expect(error?.requiredCapability).toBe("review-audit.decide");
    }
    if (code === "STALE_VERSION") {
      expect(error?.targetRef).toEqual(reviewTaskRef);
    }
  });

  it.each([
    ["unauthorized", "AUTHORIZATION_DENIED"],
    ["stale", "STALE_VERSION"],
    ["blocked", "BUSINESS_BLOCKED"],
    ["conflict", "IDEMPOTENCY_CONFLICT"],
    ["failed", "TERMINAL_FAILURE"],
  ] as const)("把修订结果 %s 映射为 %s 且不提交决定", async (kind, code) => {
    const outcome =
      kind === "conflict"
        ? { kind, priorCommandId: "command-c23:revision" }
        : { kind, detailCode: "candidate-evidence-not-frozen" };
    const harness = makeHarness({ revisionOutcome: outcome });
    const result = await harness.service.decide(
      commandFor({ kind: "approve-revised-candidate", revision: revisionBody() }),
    );
    const error = failedError(result);

    expect(error?.code).toBe(code);
    expect(harness.calls.decisions).toBe(0);
    if (code === "BUSINESS_BLOCKED") {
      expect(error?.blockerKind).toBe("candidate-evidence-not-frozen");
      expect(error?.blockerRef).toEqual(groupRef);
    }
  });
});

// ================================================================ 严格输入边界

describe("C23 严格修订输入", () => {
  it.each([
    ["modelConfidence", { riskEvent: "x", modelConfidence: 0.99 }],
    ["工序绑定", { riskEvent: "x", nodeId: "node-其它" }],
    ["空修订", {}],
  ])("拒绝 %s 越界修订且不产生任何副作用", async (_label, changes) => {
    const harness = makeHarness();
    const raw = { ...revisionBody(), changes };
    expect(IdentificationReviewRevisionV1Schema.safeParse(raw).success).toBe(false);

    const result = await harness.service.decide(
      rawCommand({ kind: "approve-revised-candidate", revision: raw }) as never,
    );
    expect(failedError(result)?.code).toBe("UNSUPPORTED_CONTRACT");
    expect(harness.calls).toEqual({ pendingReads: 0, revisions: 0, decisions: 0 });
  });

  it("拒绝未知字段，接受合法命令", async () => {
    const harness = makeHarness();
    expect(
      IdentificationHumanReviewCommandV1Schema.safeParse(
        rawCommand({ kind: "approve-unchanged", revision: revisionBody() }),
      ).success,
    ).toBe(false);
    const accepted = await harness.service.decide(
      IdentificationHumanReviewCommandV1Schema.parse(rawCommand({ kind: "reject" })),
    );
    expect(accepted.kind).toBe("succeeded");

    const withExtra = await harness.service.decide({
      ...rawCommand({ kind: "reject" }),
      modelConfidence: 0.5,
    } as never);
    expect(failedError(withExtra)?.code).toBe("UNSUPPORTED_CONTRACT");
    expect(harness.calls).toEqual({ pendingReads: 1, revisions: 0, decisions: 1 });
  });

  it("拒绝非 identification-group 复核任务", async () => {
    const harness = makeHarness();
    const foreignTask = {
      ...reviewTaskRef,
      reviewType: "knowledge-revision",
      targetRef: { kind: "knowledge-revision", reference: versionRef("knowledge-revision-1") },
    };
    expect(
      IdentificationHumanReviewCommandV1Schema.safeParse(
        rawCommand({ kind: "reject" }, { reviewTaskRef: foreignTask }),
      ).success,
    ).toBe(false);

    const result = await harness.service.decide(
      rawCommand({ kind: "reject" }, { reviewTaskRef: foreignTask }) as never,
    );
    expect(failedError(result)?.code).toBe("UNSUPPORTED_CONTRACT");
    expect(harness.calls.decisions).toBe(0);
  });
});

// ================================================================== 逐项批量

describe("C23 批量原样通过与拒绝", () => {
  const batchItem = (
    suffix: string,
    kind: "approve-unchanged" | "reject" = "approve-unchanged",
  ) => ({
    ...commandFor({ kind }),
    commandId: `command-batch-${suffix}`,
    idempotencyKey: `idempotency-batch-${suffix}`,
    reviewTaskRef: {
      ...reviewTaskRef,
      reference: versionRef(`identification-group-review:${PROJECT}:digest-group`, `v-${suffix}`),
    },
  });

  it("按输入顺序逐项返回结果，陈旧项不回滚已提交项", async () => {
    const harness = makeHarness({
      pendingRead: { kind: "blocked", detailCode: "review-task-stale" },
    });
    const valid = batchItem("1");
    const stale = batchItem("2");
    const inspected: string[] = [];
    const reader: IdentificationPendingReviewReaderV1 = {
      async readPendingIdentificationReview(input) {
        inspected.push(input.reviewTaskRef.reference.versionId);
        return input.reviewTaskRef.reference.versionId === "v-2"
          ? { kind: "blocked", detailCode: "review-task-stale" }
          : { kind: "pending", task: { ...pendingTask(), reviewTaskRef: valid.reviewTaskRef } };
      },
    };
    const service = new IdentificationHumanReviewService({
      pendingReviewReader: reader,
      reviewRevision: {
        async prepareReviewRevision() {
          throw new Error("unexpected revision");
        },
      },
      review: {
        async decideReview(command) {
          harness.calls.decisions += 1;
          harness.decisionCommands.push(command);
          return { kind: "succeeded", result: { reviewDecisionRef } };
        },
      },
      now: () => new Date(TIMESTAMP),
    });

    const result = await service.decideBatch({
      items: [valid, stale],
    } as IdentificationHumanReviewBatchV1);

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(inspected).toEqual(["v-1", "v-2"]);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.kind).toBe("succeeded");
    const staleResult = result.results[1];
    if (staleResult?.kind !== "failed") throw new Error("expected a failed batch item");
    expect(staleResult.error.code).toBe("STALE_VERSION");
    expect(harness.calls.decisions).toBe(1);
  });

  it("每项携带自己的命令身份，逐项独立决定", async () => {
    const harness = makeHarness();
    const result = await harness.service.decideBatch({
      items: [batchItem("1"), batchItem("2", "reject")],
    });

    expect(result.kind).toBe("succeeded");
    expect(harness.decisionCommands.map((command) => command.commandId)).toEqual([
      "command-batch-1",
      "command-batch-2",
    ]);
    expect(harness.decisionCommands.map((command) => command.payload.decision.kind)).toEqual([
      "approve-unchanged",
      "reject",
    ]);
  });

  it("超限、重复任务或非批量决定在执行前整体拒绝", async () => {
    const harness = makeHarness();
    const overLimit = {
      items: Array.from({ length: 65 }, (_value, index) => batchItem(String(index))),
    };
    expect(IdentificationHumanReviewBatchV1Schema.safeParse(overLimit).success).toBe(false);
    const overLimitResult = await harness.service.decideBatch(overLimit as never);
    expect(failedError(overLimitResult as never)?.code).toBeDefined();
    expect(harness.calls.decisions).toBe(0);

    const duplicated = batchItem("1");
    const duplicateResult = await harness.service.decideBatch({
      items: [duplicated, duplicated],
    } as IdentificationHumanReviewBatchV1);
    expect(duplicateResult.kind).toBe("failed");
    expect(harness.calls.decisions).toBe(0);

    const forbidden = await harness.service.decideBatch({
      items: [
        {
          ...batchItem("3"),
          decision: { reviewType: "identification-group", kind: "confirm-merge" },
        },
      ],
    } as never);
    expect(forbidden.kind).toBe("failed");
    expect(harness.calls.decisions).toBe(0);
  });
});
