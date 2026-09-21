import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ResponseRecommendationSchema } from "@riskflow/contracts/records";
import * as recommendationMigration from "../../src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import {
  C27_MEASURE_CATEGORY,
  startRecommendationFixture,
  type RecommendationPostgresFixtureV1,
} from "./fixture.js";

const MEASURE_GR = "measure-grouting";
const MEASURE_SETTLEMENT = "measure-settlement-control";
const validateAuditId = (commandId: string): string =>
  `audit-${commandId}:recommendation-validation`;

let fixture: RecommendationPostgresFixtureV1 | undefined;

const PG_TIMEOUT_MS = 240_000;
/** PostgreSQL 纵向用例统一放宽超时：每次断言都走真实事务与容器。 */
const pgIt = (name: string, body: () => Promise<unknown>): void => {
  void it(name, body, PG_TIMEOUT_MS);
};

describe("C27 处置建议 PostgreSQL 链", () => {
  beforeAll(async () => {
    fixture = await startRecommendationFixture();
  }, 600_000);

  afterEach(() => {
    const state = fixture!;
    state.setCategory(C27_MEASURE_CATEGORY);
    state.setMeasureAvailability("available");
    state.setValidationOverrides(null);
    state.setSiteContextOverrides(null);
    state.setReviewEnabled(true);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  /** 冻结候选 → 运行受限 Agent → 绑定候选：多场景共用的正式前置。 */
  const freezeAndBind = async (input: {
    readonly prefix: string;
    readonly assessments: number;
    readonly selections?: readonly { readonly measureId: string; readonly order: number }[];
    readonly state?: RecommendationPostgresFixtureV1;
  }) => {
    const state = input.state ?? fixture!;
    const opened = await state.openWarnings({
      commandPrefix: `${input.prefix}-open`,
      assessments: input.assessments,
    });
    const query = await state.measureCandidates({
      queryId: `${input.prefix}-query`,
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(query.kind === "succeeded" ? "succeeded" : JSON.stringify(query.error)).toBe(
      "succeeded",
    );
    if (query.kind !== "succeeded") throw new Error("C27 test requires a frozen candidate set");
    const queryResultRef = query.result.knowledgeQueryResultRef;
    const agent = await state.runAgent({
      suffix: `${input.prefix}-agent`,
      queryResultRef,
      selections: input.selections ?? [{ measureId: MEASURE_GR, order: 1 }],
    });
    return { opened, queryResultRef, agent };
  };

  pgIt("多预警冻结同一任务的候选，后续预警归集不改写旧候选集", async () => {
    const state = fixture!;
    const opened = await state.openWarnings({ commandPrefix: "c27-multi-open", assessments: 2 });
    const first = await state.measureCandidates({
      queryId: "c27-multi-query",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    const queryResultRef = first.result.knowledgeQueryResultRef;
    const row = await state.db
      .selectFrom("business.measure_candidate_queries")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("query_result_id", "=", queryResultRef.reference.entityId)
      .executeTakeFirst();
    expect(row?.candidate_count).toBe(1);
    expect(row?.measure_library_release_id).toBe("release-measure-library");
    expect(row?.candidate_set_artifact_version_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const candidateSet = row?.candidate_set_payload as {
      candidates: {
        measure: { measureId: string };
        triggerTypes: string[];
        warningRecordRefs: { reference: { entityId: string } }[];
      }[];
      warnings: {
        warningRecordRef: { reference: { entityId: string } };
        resolvedTargetIndicatorIds: string[];
        unresolvedTriggerItems: string[];
      }[];
    };
    expect(candidateSet.candidates.map((entry) => entry.measure.measureId)).toEqual([MEASURE_GR]);
    const merged = candidateSet.candidates[0]!;
    expect(merged.triggerTypes).toEqual(["监测指标越限"]);
    expect(candidateSet.warnings.length).toBeGreaterThanOrEqual(2);
    expect(
      candidateSet.warnings.every(
        (warning) =>
          warning.resolvedTargetIndicatorIds.includes("indicator-consequence-1") &&
          warning.unresolvedTriggerItems.length === 0,
      ),
    ).toBe(true);
    const frozenWarningIds = candidateSet.warnings
      .map((entry) => entry.warningRecordRef.reference.entityId)
      .sort();
    const matchedIds = merged.warningRecordRefs.map((ref) => ref.reference.entityId);
    expect(matchedIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(matchedIds).size).toBe(matchedIds.length);
    expect(matchedIds).toEqual([...matchedIds].sort());
    expect(matchedIds.every((id) => frozenWarningIds.includes(id))).toBe(true);
    expect(frozenWarningIds.every((id) => opened.warningRefs.includes(id))).toBe(true);

    // 后续预警归集到同一任务的新版本，不改变已冻结的旧候选集。
    const appended = await state.openWarnings({
      commandPrefix: "c27-multi-open-2",
      assessments: 1,
      riskInputKey: "c27-multi-open",
    });
    expect(appended.taskRef.reference.entityId).toBe(opened.taskRef.reference.entityId);
    expect(Number(appended.taskRef.reference.versionId)).toBeGreaterThanOrEqual(
      Number(opened.taskRef.reference.versionId),
    );
    const replay = await state.measureCandidates({
      queryId: "c27-multi-query",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(replay.kind).toBe("succeeded");
    if (replay.kind !== "succeeded") return;
    expect(replay.result.knowledgeQueryResultRef).toEqual(queryResultRef);
    expect(await state.countCommandRows("measure_candidate_queries", "c27-multi-query")).toBe(1);

    const changedInput = await state.measureCandidates({
      queryId: "c27-multi-query",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[1]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(changedInput.kind === "failed" && changedInput.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await state.countReceiptsForCommand("c27-multi-query")).toBe(1);

    const anotherCommand = await state.measureCandidates({
      queryId: "c27-multi-query-2",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(anotherCommand.kind).toBe("succeeded");
    expect(await state.countReceiptsForCommand("c27-multi-query-2")).toBe(1);
    expect(
      await state.countAuditForCommand(
        "knowledge-modeling.measure-candidates",
        "c27-multi-query-2",
      ),
    ).toBe(1);
  });

  pgIt("不合格来源不能进入候选，无合格措施时结构化阻塞", async () => {
    const state = fixture!;
    const baseline = await state.countRows("measure_candidate_queries");
    const opened = await state.openWarnings({ commandPrefix: "c27-source-open", assessments: 1 });
    const frozen = await state.measureCandidates({
      queryId: "c27-source-query",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(frozen.kind).toBe("succeeded");
    const row = await state.db
      .selectFrom("business.measure_candidate_queries")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .executeTakeFirst();
    const candidateSet = row?.candidate_set_payload as {
      candidates: { measure: { measureId: string } }[];
      applicableRuleSetRef: { entityId: string };
    };
    // 其它类别、未发布与不满足适用性的措施被排除，不从风险文案或外部事件键推断类别。
    expect(candidateSet.candidates.map((entry) => entry.measure.measureId)).toEqual([MEASURE_GR]);
    expect(candidateSet.applicableRuleSetRef.entityId).toBe("release-set-applicable-rule-set");

    state.setCategory("盾构姿态超限");
    const empty = await state.measureCandidates({
      queryId: "c27-source-empty",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(empty.kind === "failed" && empty.error.code).toBe("BUSINESS_BLOCKED");
    expect(
      empty.kind === "failed" && empty.error.code === "BUSINESS_BLOCKED"
        ? empty.error.blockerKind
        : "",
    ).toBe("measure-candidates-empty");

    state.setCategory(undefined);
    const unbound = await state.measureCandidates({
      queryId: "c27-source-unbound",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(unbound.kind === "failed" && unbound.error.code).toBe("BUSINESS_BLOCKED");

    state.setCategory(C27_MEASURE_CATEGORY);
    state.setMeasureAvailability("missing");
    const unavailable = await state.measureCandidates({
      queryId: "c27-source-unavailable",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(unavailable.kind === "failed" && unavailable.error.code).toBe("BUSINESS_BLOCKED");
    expect(await state.countRows("measure_candidate_queries")).toBe(baseline + 1);
  });

  pgIt("合法组合成为建议候选，越界增量被逐项拒绝", async () => {
    const state = fixture!;
    const { opened, queryResultRef, agent } = await freezeAndBind({
      prefix: "c27-agent-ok",
      assessments: 1,
    });
    expect(agent.validation.disposition).toBe("accepted");
    expect(agent.validation.validationArtifactRef.reference.versionId).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(agent.candidateRef?.kind).toBe("recommendation-candidate");
    const candidateRow = await state.db
      .selectFrom("business.recommendation_candidates")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("candidate_id", "=", agent.candidateRef!.reference.entityId)
      .executeTakeFirst();
    expect(candidateRow?.warning_response_task_id).toBe(opened.taskRef.reference.entityId);
    expect(candidateRow?.query_result_id).toBe(queryResultRef.reference.entityId);
    expect(candidateRow?.agent_task_type).toBe("response-recommendation");
    expect(candidateRow?.parent_run_id).toBe("c27-agent-run");
    const task = await state.taskSnapshot(agent.taskRef);
    expect(task?.state.status).toBe("completed");
    expect(await state.countCandidatesForTask(opened.taskRef.reference.entityId)).toBe(1);
    expect(await state.countCommandRows("response_recommendations", "c27-agent-ok-open-0")).toBe(0);

    const rejected = await freezeAndBind({
      prefix: "c27-agent-reject",
      assessments: 1,
      selections: [{ measureId: MEASURE_SETTLEMENT, order: 1 }],
    });
    expect(rejected.agent.validation.disposition).toBe("rejected");
    expect(rejected.agent.validation.rejectionClass).toBe("repairable");
    expect(rejected.agent.validation.items[0]?.reasonCode).toBe(
      "measure-outside-frozen-candidates",
    );
    expect(rejected.agent.candidateRef).toBeUndefined();
    const rejectedTask = await state.taskSnapshot(rejected.agent.taskRef);
    expect(rejectedTask?.state.status).not.toBe("completed");
    expect(await state.countCandidatesForTask(rejected.agent.taskRef.reference.entityId)).toBe(0);
    expect(
      await state.countCommandRows("response_recommendations", "c27-agent-reject-open-0"),
    ).toBe(0);
  });

  pgIt("create-candidate 只绑定精确冻结结果并保持幂等", async () => {
    const state = fixture!;
    const { opened, queryResultRef, agent } = await freezeAndBind({
      prefix: "c27-bind",
      assessments: 1,
    });
    const bound = await state.createCandidate({
      commandId: "c27-bind-command",
      warningResponseTaskRef: opened.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: agent.agentResultRef!,
      responseGenerationPolicyRef: state.generationPolicyRef,
    });
    expect(bound.kind).toBe("succeeded");
    if (bound.kind !== "succeeded") return;
    expect(bound.result.kind).toBe("candidate");
    const candidateRef =
      bound.result.kind === "candidate" ? bound.result.recommendationCandidateRef : undefined;
    expect(candidateRef).toEqual(agent.candidateRef);

    const replay = await state.createCandidate({
      commandId: "c27-bind-command",
      warningResponseTaskRef: opened.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: agent.agentResultRef!,
      responseGenerationPolicyRef: state.generationPolicyRef,
    });
    expect(replay).toEqual(bound);
    expect(await state.countCandidatesForTask(opened.taskRef.reference.entityId)).toBe(1);
    expect(
      await state.countAuditForCommand("warning-response.create-candidate", "c27-bind-command"),
    ).toBe(1);
    expect(await state.countReceiptsForCommand("c27-bind-command")).toBe(1);
  });

  pgIt("create-candidate 拒绝错配、过期与失败结果", async () => {
    const state = fixture!;
    const { opened, queryResultRef, agent } = await freezeAndBind({
      prefix: "c27-mismatch",
      assessments: 1,
    });
    const other = await freezeAndBind({ prefix: "c27-mismatch-other", assessments: 1 });
    const stalePolicy = await state.createCandidate({
      commandId: "c27-mismatch-policy",
      warningResponseTaskRef: opened.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: agent.agentResultRef!,
      responseGenerationPolicyRef: { entityId: "response-generation-policy", versionId: "9" },
    });
    expect(stalePolicy.kind === "failed" && stalePolicy.error.code).toBe("STALE_VERSION");

    const otherTask = await state.createCandidate({
      commandId: "c27-mismatch-task",
      warningResponseTaskRef: other.opened.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: agent.agentResultRef!,
      responseGenerationPolicyRef: state.generationPolicyRef,
    });
    expect(otherTask.kind === "failed" && otherTask.error.code).toBe("STALE_VERSION");

    const fabricated = {
      ...agent.agentResultRef!,
      reference: { entityId: "agent-result-fabricated", versionId: "1" },
    };
    const forged = await state.createCandidate({
      commandId: "c27-mismatch-result",
      warningResponseTaskRef: opened.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: fabricated,
      responseGenerationPolicyRef: state.generationPolicyRef,
    });
    expect(forged.kind === "failed" && forged.error.code).toBe("STALE_VERSION");

    const failedQuery = await state.measureCandidates({
      queryId: "c27-mismatch-failed-query",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(failedQuery.kind).toBe("succeeded");
    if (failedQuery.kind !== "succeeded") return;
    const failedTaskRef = await state.failAgent({
      suffix: "c27-mismatch-failed",
      queryResultRef: failedQuery.result.knowledgeQueryResultRef,
    });
    const failedSnapshot = await state.taskSnapshot(failedTaskRef);
    expect(failedSnapshot?.state.status).toBe("terminal-failure");
    expect(failedSnapshot?.state.error?.code).toBe("AGENT_BUDGET_EXHAUSTED");
    expect(await state.countCandidatesForTask(failedTaskRef.reference.entityId)).toBe(0);
    expect(await state.countCandidatesForTask(opened.taskRef.reference.entityId)).toBe(1);
    expect(
      await state.countCommandRows("recommendation_candidates", "c27-mismatch-failed-command"),
    ).toBe(0);
    expect(await state.countRows("response_recommendations")).toBe(0);
  });

  pgIt("三项均通过时正式建议入库并可重放", async () => {
    const state = fixture!;
    const { agent } = await freezeAndBind({ prefix: "c27-record", assessments: 1 });
    const recorded = await state.validateAndRecord({
      commandId: "c27-record-command",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(recorded.kind).toBe("succeeded");
    if (recorded.kind !== "succeeded" || recorded.result.kind !== "recorded") return;
    const recommendationRef = recorded.result.responseRecommendationRef;
    const row = await state.db
      .selectFrom("business.response_recommendations")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("recommendation_id", "=", recommendationRef.reference.entityId)
      .executeTakeFirst();
    expect(row?.review_status).toBe("pending");
    expect(row?.measure_library_release_id).toBe("release-measure-library");
    expect(row?.validation_policy_entity_id).toBe("response-validation-policy");
    expect(row?.site_context_entity_id).toBe("site-context-c27");
    const record = ResponseRecommendationSchema.parse(row?.record_payload);
    expect(record.measureItems.map((item) => item.measureId)).toEqual([MEASURE_GR]);
    expect(record.implementationOrder).toEqual([MEASURE_GR]);
    expect(record.resourceRequirements).toEqual(["grouting-materials"]);
    expect(record.targetIndicators).toEqual([
      { indicatorItem: "indicator-consequence-1", targetValue: 5 },
    ]);
    expect(record.triggerConsistencyValidation).toEqual({ passed: true, issues: [] });
    expect(record.standardsComplianceValidation).toEqual({ passed: true, issues: [] });
    expect(record.siteFeasibilityValidation).toEqual({ passed: true, issues: [] });
    expect(record.reviewStatus).toBe("pending");

    const validation = await state.db
      .selectFrom("business.recommendation_validations")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .executeTakeFirst();
    expect(validation?.trigger_consistency_passed).toBe(true);
    expect(validation?.standards_compliance_passed).toBe(true);
    expect(validation?.site_feasibility_passed).toBe(true);
    expect(validation?.review_task_id).toBeNull();
    expect(validation?.evidence_artifact_version_id).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const replay = await state.validateAndRecord({
      commandId: "c27-record-command",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(replay).toEqual(recorded);
    expect(await state.countCommandRows("recommendation_validations", "c27-record-command")).toBe(
      1,
    );
    expect(await state.countCommandRows("response_recommendations", "c27-record-command")).toBe(1);
    expect(
      await state.countAuditForCommand(
        "warning-response.validate-and-record",
        "c27-record-command",
      ),
    ).toBe(1);
  });

  pgIt("冻结映射缺失或措施未覆盖已解析指标时待复核且无正式建议", async () => {
    for (const variant of ["missing-mapping", "uncovered-target"] as const) {
      const state = await startRecommendationFixture(variant);
      try {
        const { agent } = await freezeAndBind({
          prefix: `c27-trigger-${variant}`,
          assessments: 1,
          state,
        });
        const result = await state.validateAndRecord({
          commandId: `c27-trigger-${variant}-validate`,
          recommendationCandidateRef: agent.candidateRef!,
          responseValidationPolicyRef: state.validationPolicyRef,
          siteContextRef: state.siteContextRef,
        });
        expect(result.kind === "succeeded" && result.result.kind).toBe("waiting-review");
        const row = await state.db
          .selectFrom("business.recommendation_validations")
          .selectAll()
          .where("candidate_id", "=", agent.candidateRef!.reference.entityId)
          .executeTakeFirst();
        expect(row?.trigger_consistency_passed).toBe(false);
        expect(row?.standards_compliance_passed).toBe(true);
        expect(row?.site_feasibility_passed).toBe(true);
        expect(row?.review_task_id).toBeTruthy();
        const evidence = row?.validation_payload as {
          diagnostics: { reasonCode: string }[];
        };
        expect(
          evidence.diagnostics.some(
            (entry) =>
              entry.reasonCode ===
              (variant === "missing-mapping"
                ? "trigger-mapping-unavailable"
                : "trigger-indicator-uncovered"),
          ),
        ).toBe(true);
        expect(await state.countRows("response_recommendations")).toBe(0);
      } finally {
        await state.close();
      }
    }
  });

  pgIt("任一项失败或依据缺失时保留失败快照并进入复核", async () => {
    const state = fixture!;
    const missingTarget = await freezeAndBind({ prefix: "c27-fail-trigger", assessments: 1 });
    state.setValidationOverrides({
      targetIndicators: [{ indicatorItem: "indicator-possibility-2", targetValue: 5 }],
    });
    const triggerRejected = await state.validateAndRecord({
      commandId: "c27-fail-trigger-command",
      recommendationCandidateRef: missingTarget.agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(triggerRejected.kind).toBe("succeeded");
    if (triggerRejected.kind !== "succeeded") return;
    expect(triggerRejected.result.kind).toBe("waiting-review");
    const reviewTaskRef =
      triggerRejected.result.kind === "waiting-review"
        ? triggerRejected.result.reviewTaskRef
        : undefined;
    expect(reviewTaskRef?.reviewType).toBe("response-candidate");
    expect(reviewTaskRef?.targetRef).toEqual(missingTarget.agent.candidateRef);
    const triggerValidation = await state.db
      .selectFrom("business.recommendation_validations")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("candidate_id", "=", missingTarget.agent.candidateRef!.reference.entityId)
      .executeTakeFirst();
    expect(triggerValidation?.trigger_consistency_passed).toBe(false);
    expect(triggerValidation?.standards_compliance_passed).toBe(true);
    expect(triggerValidation?.site_feasibility_passed).toBe(true);
    expect(triggerValidation?.review_task_id).toBe(reviewTaskRef?.reference.entityId);
    expect(
      await state.countCommandRows("response_recommendations", "c27-fail-trigger-command"),
    ).toBe(0);

    // C07 成功而 C27 事务失败后，同键重试复用同一 review ref，且不产生正式建议。
    const auditConflict = validateAuditId("c27-fail-retry-command");
    const retried = await freezeAndBind({ prefix: "c27-fail-retry", assessments: 1 });
    state.setValidationOverrides({
      reviewedStandardEvidence: [],
    });
    await state.preinsertAuditConflict(auditConflict);
    const broken = await state.validateAndRecord({
      commandId: "c27-fail-retry-command",
      recommendationCandidateRef: retried.agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(broken.kind).toBe("failed");
    expect(
      await state.countCommandRows("recommendation_validations", "c27-fail-retry-command"),
    ).toBe(0);
    await state.clearAuditConflict(auditConflict);
    const retry = await state.validateAndRecord({
      commandId: "c27-fail-retry-command",
      recommendationCandidateRef: retried.agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(retry.kind).toBe("succeeded");
    if (retry.kind !== "succeeded" || retry.result.kind !== "waiting-review") return;
    const retriedRow = await state.db
      .selectFrom("business.recommendation_validations")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("candidate_id", "=", retried.agent.candidateRef!.reference.entityId)
      .executeTakeFirst();
    expect(retriedRow?.standards_compliance_passed).toBe(false);
    expect(retriedRow?.review_task_id).toBe(retry.result.reviewTaskRef.reference.entityId);
    expect(await state.countReviewTasks(retried.agent.candidateRef!.reference.entityId)).toBe(1);
    expect(
      await state.countCommandRows("recommendation_validations", "c27-fail-retry-command"),
    ).toBe(1);
    expect(await state.countCommandRows("response_recommendations", "c27-fail-retry-command")).toBe(
      0,
    );

    // 现场资源与工序依据不足同样只进入复核。
    const siteFailed = await freezeAndBind({ prefix: "c27-fail-site", assessments: 1 });
    state.setSiteContextOverrides({ availableResources: [], processStatus: "已完工" });
    const siteRejected = await state.validateAndRecord({
      commandId: "c27-fail-site-command",
      recommendationCandidateRef: siteFailed.agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(siteRejected.kind === "succeeded" && siteRejected.result.kind).toBe("waiting-review");
    const siteValidation = await state.db
      .selectFrom("business.recommendation_validations")
      .selectAll()
      .where("project_id", "=", state.projectId)
      .where("candidate_id", "=", siteFailed.agent.candidateRef!.reference.entityId)
      .executeTakeFirst();
    expect(siteValidation?.site_feasibility_passed).toBe(false);
    expect(
      await state.countCommandRows("recommendation_validations", "c27-fail-site-command"),
    ).toBe(1);
    expect(await state.countCommandRows("response_recommendations", "c27-fail-site-command")).toBe(
      0,
    );
  });

  pgIt("不完整或过期候选不冒充正式建议", async () => {
    const state = fixture!;
    const { agent } = await freezeAndBind({ prefix: "c27-immutable", assessments: 1 });
    const stalePolicy = await state.validateAndRecord({
      commandId: "c27-immutable-policy",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: { entityId: "response-validation-policy", versionId: "9" },
      siteContextRef: state.siteContextRef,
    });
    expect(stalePolicy.kind === "failed" && stalePolicy.error.code).toBe("STALE_VERSION");
    const unknownCandidate = await state.validateAndRecord({
      commandId: "c27-immutable-unknown",
      recommendationCandidateRef: {
        kind: "recommendation-candidate",
        reference: { entityId: "recommendation-candidate-absent", versionId: "1" },
      },
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(unknownCandidate.kind === "failed" && unknownCandidate.error.code).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(await state.countCommandRows("recommendation_validations", "c27-immutable-policy")).toBe(
      0,
    );
    expect(
      await state.countCommandRows("recommendation_validations", "c27-immutable-unknown"),
    ).toBe(0);
    expect(await state.countCommandRows("response_recommendations", "c27-immutable-policy")).toBe(
      0,
    );
  });

  pgIt("无权、跨工程与越界空间在读取目标前不可枚举地失败", async () => {
    const state = fixture!;
    const opened = await state.openWarnings({ commandPrefix: "c27-auth-open", assessments: 1 });
    const baseline = await state.countRows("measure_candidate_queries");
    const foreign = await state.foreignMeasureCandidates({
      queryId: "c27-auth-foreign",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
    });
    expect(foreign.kind === "failed" && foreign.error.code).toBe("AUTHORIZATION_DENIED");
    const restrictedExisting = await state.measureCandidates({
      queryId: "c27-auth-restricted",
      warningResponseTaskRef: opened.taskRef,
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
      spatialScope: "restricted",
    });
    expect(restrictedExisting.kind === "failed" && restrictedExisting.error.code).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(
      restrictedExisting.kind === "failed" &&
        restrictedExisting.error.code === "AUTHORIZATION_DENIED"
        ? restrictedExisting.error.requiredCapability
        : "",
    ).toBe("knowledge-modeling.retrieve");
    const restrictedAbsent = await state.measureCandidates({
      queryId: "c27-auth-absent",
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: { entityId: "task-c27-absent", versionId: "1" },
      },
      assessmentRecordRef: opened.assessmentRecordRefs[0]!,
      measureLibraryReleaseRef: state.measureLibraryReleaseRef,
      spatialScope: "restricted",
    });
    expect(restrictedAbsent.kind).toBe("failed");
    expect(restrictedExisting.kind).toBe("failed");
    if (restrictedAbsent.kind !== "failed" || restrictedExisting.kind !== "failed") return;
    expect(restrictedAbsent.error.code).toBe(restrictedExisting.error.code);
    expect(restrictedAbsent.error.code).toBe("AUTHORIZATION_DENIED");
    expect(restrictedAbsent.error).toMatchObject({
      requiredCapability: "knowledge-modeling.retrieve",
      stageCode: "warning-response.recommendation",
    });
    expect(await state.countRows("measure_candidate_queries")).toBe(baseline);

    const {
      opened: boundTask,
      queryResultRef,
      agent,
    } = await freezeAndBind({
      prefix: "c27-auth-bound",
      assessments: 1,
    });
    const restrictedCreate = await state.createCandidate({
      commandId: "c27-auth-restricted-create",
      spatialScope: "restricted",
      warningResponseTaskRef: boundTask.taskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: agent.agentResultRef!,
      responseGenerationPolicyRef: state.generationPolicyRef,
    });
    const restrictedValidate = await state.validateAndRecord({
      commandId: "c27-auth-restricted-validate",
      spatialScope: "restricted",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    for (const result of [restrictedCreate, restrictedValidate]) {
      expect(result.kind === "failed" && result.error.code).toBe("AUTHORIZATION_DENIED");
    }
    expect(await state.countReceiptsForCommand("c27-auth-restricted-create")).toBe(0);
    expect(await state.countReceiptsForCommand("c27-auth-restricted-validate")).toBe(0);
    expect(
      await state.countCommandRows("recommendation_validations", "c27-auth-restricted-validate"),
    ).toBe(0);
    expect(
      await state.countCommandRows("response_recommendations", "c27-auth-restricted-validate"),
    ).toBe(0);
  });

  pgIt("审计写入失败时同事务回滚并按原幂等身份重试", async () => {
    const state = fixture!;
    const { agent } = await freezeAndBind({ prefix: "c27-rollback", assessments: 1 });
    const auditConflict = validateAuditId("c27-rollback-command");
    await state.preinsertAuditConflict(auditConflict);
    const failed = await state.validateAndRecord({
      commandId: "c27-rollback-command",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(failed.kind).toBe("failed");
    expect(await state.countCommandRows("recommendation_validations", "c27-rollback-command")).toBe(
      0,
    );
    expect(await state.countCommandRows("response_recommendations", "c27-rollback-command")).toBe(
      0,
    );
    expect(await state.countReceiptsForCommand("c27-rollback-command")).toBe(0);
    await state.clearAuditConflict(auditConflict);

    const retried = await state.validateAndRecord({
      commandId: "c27-rollback-command",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(retried.kind === "succeeded" && retried.result.kind).toBe("recorded");
    expect(await state.countCommandRows("recommendation_validations", "c27-rollback-command")).toBe(
      1,
    );
    expect(await state.countCommandRows("response_recommendations", "c27-rollback-command")).toBe(
      1,
    );
    expect(await state.countReceiptsForCommand("c27-rollback-command")).toBe(1);
    expect(await state.openReceiptCount()).toBe(0);
  });

  pgIt("正式建议入库不产生采纳、执行、反馈或任务关闭事实", async () => {
    const state = fixture!;
    const { opened, agent } = await freezeAndBind({ prefix: "c27-adopt", assessments: 1 });
    const recorded = await state.validateAndRecord({
      commandId: "c27-adopt-command",
      recommendationCandidateRef: agent.candidateRef!,
      responseValidationPolicyRef: state.validationPolicyRef,
      siteContextRef: state.siteContextRef,
    });
    expect(recorded.kind === "succeeded" && recorded.result.kind).toBe("recorded");
    const tasks = await state.c26.taskRows();
    const task = tasks.find((row) => row.taskId === opened.taskRef.reference.entityId);
    expect(task?.status).toBe("open");
    expect(
      await state.c26.acknowledgementRows({
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: opened.warningRefs[0]!, versionId: "1" },
        },
      }),
    ).toHaveLength(0);
    expect(await state.countAudit("warning-response.acknowledge")).toBe(0);
    expect(await state.countReceipts("warning-response.adopt-recommendation")).toBe(0);
    expect(await state.countReceipts("warning-response.record-execution")).toBe(0);
    expect(await state.countReceipts("warning-response.record-feedback")).toBe(0);
    const links = await state.c26.taskLinkRows(opened.taskRef.reference.entityId);
    expect(links.map((link) => link.warningRecordId).sort()).toEqual(
      [...opened.warningRefs].sort(),
    );
  });

  it("000045 迁移可重复 up 且逆序 down 后能重新建立四表", async () => {
    const state = fixture!;
    const runtime = createPostgresRuntime(
      state.c26.c25.postgres.postgres.migrator,
      "riskflow_migrator",
    );
    const tables = [
      "measure_candidate_queries",
      "recommendation_candidates",
      "recommendation_validations",
      "response_recommendations",
    ];
    try {
      const tableCount = async (): Promise<number> => {
        const result = await state.c26.c25.postgres.postgres.adminPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM information_schema.tables
             WHERE table_schema = 'business' AND table_name = ANY($1::text[])`,
          [tables],
        );
        return Number(result.rows[0]?.count ?? "0");
      };
      expect(await tableCount()).toBe(tables.length);
      await recommendationMigration.up(runtime.db);
      expect(await tableCount()).toBe(tables.length);
      await recommendationMigration.down(runtime.db);
      expect(await tableCount()).toBe(0);
      await recommendationMigration.up(runtime.db);
      expect(await tableCount()).toBe(tables.length);
      const grants = await state.c26.c25.postgres.postgres.adminPool.query<{
        table_name: string;
        privilege_type: string;
      }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE grantee = 'riskflow_app' AND table_schema = 'business' AND table_name = ANY($1::text[])
           ORDER BY table_name, privilege_type`,
        [tables],
      );
      expect(grants.rows.filter((row) => row.privilege_type === "UPDATE")).toHaveLength(0);
      expect(grants.rows.filter((row) => row.privilege_type === "INSERT")).toHaveLength(4);
    } finally {
      await runtime.close();
    }
  }, 240_000);
});
