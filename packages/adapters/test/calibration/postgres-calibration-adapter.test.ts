/**
 * C29 PostgreSQL 纵向验收：真实迁移链 + C03 事务 + C04 内容寻址工件 + 真实 C06/C07/C08 + calibration adapter。
 * 每个用例都断言真实持久化事实（三表行、工件、回执、审计、Outbox）与真实适配器接缝，不锁定 SQL 顺序。
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationContextV1Schema, type ModuleErrorV1 } from "@riskflow/contracts/ports";
import { AssessmentConfigurationDocumentV1Schema } from "@riskflow/core/assessment-config";

import * as calibrationMigration from "../../src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import {
  C29_CANDIDATE_PURPOSE,
  C29_FIXTURE_TIME,
  C29_FROZEN_INPUT_PURPOSE,
  C29_SUGGESTION_EVENT_TYPE,
  startCalibrationFixture,
  type CalibrationPostgresFixtureV1,
} from "./fixture.js";

const CALIBRATION_TABLES = [
  "calibration_deviation_records",
  "calibration_governance_drafts",
  "calibration_suggestions",
] as const;

interface SuggestionRowV1 {
  readonly suggestion_id: string;
  readonly version_id: string;
  readonly status: string;
  readonly candidate_digest: string;
  readonly command_id: string;
  readonly frozen_input_artifact_id: string;
  readonly review_task_id: string;
  readonly returned_decision_ref: unknown;
  readonly approved_decision_ref: unknown;
}

interface DeviationRecordRowV1 {
  readonly deviation_record_id: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly review_status: string;
  readonly review_decision_ref: unknown;
  readonly record_payload: {
    readonly calibrationRecommendation: string;
    readonly reviewStatus: string;
    readonly version: { readonly reference: { readonly versionId: string } };
  };
}

interface GovernanceDraftRowV1 {
  readonly draft_id: string;
  readonly version_id: string;
  readonly candidate_artifact_id: string;
  readonly candidate_digest: string;
  readonly knowledge_revision_id: string;
}

type SuggestionRefV1 = {
  readonly kind: "calibration-suggestion";
  readonly reference: { readonly entityId: string; readonly versionId: string };
};

/** 无证明拒绝与跨工程不可枚举只固定可比较部分：时间戳易变，决定引用由调用方原样提交。 */
const failureShape = (error: ModuleErrorV1) => ({
  ...error,
  occurredAt: "<volatile>",
  targetRef: "<caller-supplied>",
});

describe.sequential("PostgreSQL calibration adapter", () => {
  let fixture: CalibrationPostgresFixtureV1 | undefined;

  beforeAll(async () => {
    fixture = await startCalibrationFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  const suggestionRows = (): Promise<SuggestionRowV1[]> =>
    fixture!.rows<SuggestionRowV1>(
      "SELECT * FROM business.calibration_suggestions WHERE project_id = $1 ORDER BY suggestion_id",
      [fixture!.projectId],
    );
  const deviationRows = (): Promise<DeviationRecordRowV1[]> =>
    fixture!.rows<DeviationRecordRowV1>(
      `SELECT * FROM business.calibration_deviation_records
       WHERE project_id = $1 ORDER BY deviation_record_id, version_number`,
      [fixture!.projectId],
    );
  const draftRows = (): Promise<GovernanceDraftRowV1[]> =>
    fixture!.rows<GovernanceDraftRowV1>(
      "SELECT * FROM business.calibration_governance_drafts WHERE project_id = $1 ORDER BY draft_id",
      [fixture!.projectId],
    );
  const artifactCount = async (): Promise<number> =>
    Number(
      (
        await fixture!.rows<{ count: string }>(
          "SELECT count(*)::text AS count FROM business.artifact_manifests WHERE project_id = $1",
          [fixture!.projectId],
        )
      )[0]?.count ?? "0",
    );
  const rowsFor = (deviationRecordId: string) =>
    deviationRows().then((rows) =>
      rows.filter((row) => row.deviation_record_id === deviationRecordId),
    );

  /** 冻结输入 → 真实 C08 执行 → 建议命令；返回供断言使用的引用与命令。 */
  const prepareSuggestionCommand = async (input: {
    readonly suffix: string;
    readonly threshold: string;
  }) => {
    const fact = fixture!.deviationFacts.seed({ suffix: input.suffix, thresholdExceeded: true });
    const prepared = await fixture!.prepareInput({
      requestId: `c29-prepare-${input.suffix}`,
      deviationFactRef: fact.deviationFactRef,
    });
    expect(prepared.kind, `prepareInput(${input.suffix})`).toBe("succeeded");
    if (prepared.kind !== "succeeded") throw new Error("prepareInput did not succeed");
    const task = await fixture!.runCalibrationTask({
      suffix: input.suffix,
      frozenInputRef: prepared.result.frozenInputRef,
      inputSnapshotRef: prepared.result.inputSnapshotRef,
      operations: fixture!.operations(input.threshold),
    });
    const command = await fixture!.suggestionCommand({
      commandId: `c29-suggest-${input.suffix}`,
      deviationRecordRef: prepared.result.deviationRecordRef,
      agentTaskResultRef: task.resultRef,
    });
    return { fact, prepared, task, command };
  };

  /** 上述命令的成功收口：建议、pending 记录、复核请求与 Outbox 事件。 */
  const seedSuggestion = async (input: { readonly suffix: string; readonly threshold: string }) => {
    const staged = await prepareSuggestionCommand(input);
    const result = await fixture!.createSuggestion(staged.command);
    expect(result.kind, `createSuggestion(${input.suffix})`).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "calibration") {
      throw new Error(`createSuggestion did not succeed for ${input.suffix}`);
    }
    return { ...staged, result: result.result };
  };

  it("基线硬门：三张校准表存在且 riskflow_app 只有 SELECT/INSERT", async () => {
    const tables = await fixture!.rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'business' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[...CALIBRATION_TABLES]],
    );
    expect(tables.map((row) => row.table_name)).toEqual([...CALIBRATION_TABLES]);

    const appPool = new Pool(fixture!.postgres.app);
    try {
      for (const table of CALIBRATION_TABLES) {
        const privileges = await fixture!.rows<{
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
        }>(
          `SELECT has_table_privilege('riskflow_app', $1, 'SELECT') AS can_select,
                  has_table_privilege('riskflow_app', $1, 'INSERT') AS can_insert,
                  has_table_privilege('riskflow_app', $1, 'UPDATE') AS can_update,
                  has_table_privilege('riskflow_app', $1, 'DELETE') AS can_delete`,
          [`business.${table}`],
        );
        expect(privileges[0], table).toEqual({
          can_select: true,
          can_insert: true,
          can_update: false,
          can_delete: false,
        });
        await expect(
          appPool.query(`UPDATE business.${table} SET project_id = project_id`),
        ).rejects.toBeDefined();
        await expect(appPool.query(`DELETE FROM business.${table}`)).rejects.toBeDefined();
      }
    } finally {
      await appPool.end();
    }
  });

  it("migration supports down and up", async () => {
    const migrator = createPostgresRuntime(fixture!.postgres.migrator, "riskflow_migrator");
    const sentinelId = "c29-migration-sentinel";
    try {
      await fixture!.preinsertAuditConflict(sentinelId);
      await calibrationMigration.down(migrator.db);
      const dropped = await fixture!.rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'business' AND table_name = ANY($1::text[])`,
        [[...CALIBRATION_TABLES]],
      );
      expect(dropped).toHaveLength(0);
      await calibrationMigration.up(migrator.db);
      const recreated = await fixture!.rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'business' AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [[...CALIBRATION_TABLES]],
      );
      expect(recreated.map((row) => row.table_name)).toEqual([...CALIBRATION_TABLES]);
      const sentinel = await fixture!.rows<{ audit_entry_id: string }>(
        "SELECT audit_entry_id FROM audit.entries WHERE audit_entry_id = $1",
        [sentinelId],
      );
      expect(sentinel).toHaveLength(1);
    } finally {
      await fixture!.clearAuditConflict(sentinelId).catch(() => undefined);
      await migrator.close();
    }
  });

  it("已越限事实进入校准：冻结输入落工件且公共记录身份稳定", async () => {
    const fact = fixture!.deviationFacts.seed({ suffix: "exceeded", thresholdExceeded: true });
    const first = await fixture!.prepareInput({
      requestId: "c29-prepare-exceeded",
      deviationFactRef: fact.deviationFactRef,
    });
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    expect(first.result.targetDefinitionType).toBe(fixture!.targetDefinitionType);

    const replay = await fixture!.prepareInput({
      requestId: "c29-prepare-exceeded",
      deviationFactRef: fact.deviationFactRef,
    });
    expect(replay).toEqual(first);

    const manifests = await fixture!.rows<{ purpose_code: string; artifact_id: string }>(
      `SELECT purpose_code, artifact_id FROM business.artifact_manifests
       WHERE project_id = $1 AND artifact_id = $2 AND version_id = $3`,
      [
        fixture!.projectId,
        first.result.frozenInputRef.reference.entityId,
        first.result.frozenInputRef.reference.versionId,
      ],
    );
    expect(manifests).toEqual([
      {
        purpose_code: C29_FROZEN_INPUT_PURPOSE,
        artifact_id: first.result.frozenInputRef.reference.entityId,
      },
    ]);
    expect(
      await fixture!.readArtifact(first.result.frozenInputRef, C29_FROZEN_INPUT_PURPOSE),
    ).toMatchObject({
      projectId: fixture!.projectId,
      deviationFactRef: fact.deviationFactRef,
      deviationRecordRef: first.result.deviationRecordRef,
      targetDefinitionType: fixture!.targetDefinitionType,
      targetReleaseRef: fixture!.targetReleaseRef,
      baseContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("未越限事实不进入校准且不产生任何持久化事实", async () => {
    const before = {
      suggestions: (await suggestionRows()).length,
      deviations: (await deviationRows()).length,
      drafts: (await draftRows()).length,
      artifacts: await artifactCount(),
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    };
    const fact = fixture!.deviationFacts.seed({ suffix: "within", thresholdExceeded: false });
    const result = await fixture!.prepareInput({
      requestId: "c29-prepare-within",
      deviationFactRef: fact.deviationFactRef,
    });
    expect(result).toEqual({
      kind: "not-applicable",
      reasonCode: "calibration-deviation-within-threshold",
    });
    expect({
      suggestions: (await suggestionRows()).length,
      deviations: (await deviationRows()).length,
      drafts: (await draftRows()).length,
      artifacts: await artifactCount(),
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    }).toEqual(before);
    const receipts = await fixture!.rows<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.command_receipts
       WHERE project_id = $1 AND idempotency_key = $2`,
      [fixture!.projectId, "c29-prepare-within"],
    );
    expect(receipts[0]?.count).toBe("0");
  });

  it("无权先拒绝：缺少记录能力时在读事实之前失败关闭", async () => {
    const fact = fixture!.deviationFacts.seed({ suffix: "denied", thresholdExceeded: true });
    const command = await fixture!.prepareCommand({
      requestId: "c29-prepare-denied",
      deviationFactRef: fact.deviationFactRef,
    });
    const ungranted = AuthorizationContextV1Schema.parse({
      ...command.authorization,
      grantedCapabilities: ["knowledge-modeling.read"],
    });
    const readsBefore = fixture!.deviationFacts.readCalls.length;
    const result = await fixture!.calibration.prepareInput({
      ...command,
      authorization: ungranted,
    });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result).toMatchObject({
      error: { code: "AUTHORIZATION_DENIED", category: "authorization", retryable: false },
    });
    expect(fixture!.deviationFacts.readCalls.length).toBe(readsBefore);
    expect(
      fixture!.access.verifyCalls.some((call) => call.invocationId === "c29-prepare-denied"),
    ).toBe(false);

    // 真实 C06 按精确分支只签发单一能力：夹具不会把更宽的上游授权透传给下游接缝。
    const narrowed = await fixture!.authorizationFor(
      "warning-response.calculate-deviation",
      "c29-narrowing-probe",
    );
    expect(narrowed.grantedCapabilities).toEqual(["warning-response.record"]);
    expect(narrowed.projectId).toBe(fixture!.projectId);
  });

  it("合格候选收口：建议、pending 记录、复核任务与 Outbox 事件原子成立", async () => {
    const seeded = await seedSuggestion({ suffix: "happy", threshold: "3" });
    const suggestionRef = seeded.result.calibrationSuggestionRef;

    const suggestions = await suggestionRows();
    expect(suggestions).toHaveLength(1);
    const suggestion = suggestions[0]!;
    expect({
      id: suggestion.suggestion_id,
      status: suggestion.status,
      reviewTaskId: suggestion.review_task_id,
      frozenInputId: suggestion.frozen_input_artifact_id,
      commandId: suggestion.command_id,
    }).toEqual({
      id: suggestionRef.reference.entityId,
      status: "pending-review",
      reviewTaskId: seeded.result.reviewTaskRef.reference.entityId,
      frozenInputId: seeded.prepared.result.frozenInputRef.reference.entityId,
      commandId: "c29-suggest-happy",
    });
    expect(suggestion.candidate_digest).toMatch(/^[0-9a-f]{64}$/u);

    const deviations = await deviationRows();
    expect(deviations).toHaveLength(1);
    const record = deviations[0]!;
    expect({
      version: record.version_id,
      versionNumber: record.version_number,
      reviewStatus: record.review_status,
      decision: record.review_decision_ref,
    }).toEqual({ version: "1", versionNumber: 1, reviewStatus: "pending", decision: null });
    expect(record.record_payload).toMatchObject({
      reviewStatus: "pending",
      calibrationRecommendation: suggestionRef.reference.entityId,
    });

    // 复核任务是真实 C07 行：类型、目标与等待运行都绑定这次建议。
    const reviewTasks = await fixture!.rows<{
      review_type: string;
      target_ref: { reference: { entityId: string } };
    }>(
      `SELECT review_type, target_ref FROM business.review_tasks
       WHERE project_id = $1 AND review_task_id = $2`,
      [fixture!.projectId, seeded.result.reviewTaskRef.reference.entityId],
    );
    expect(reviewTasks).toHaveLength(1);
    expect(reviewTasks[0]!.review_type).toBe("calibration-suggestion");
    expect(reviewTasks[0]!.target_ref.reference.entityId).toBe(suggestionRef.reference.entityId);
    expect(seeded.result.reviewTaskRef.reference.versionId).toBe("1");

    expect(await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE)).toBe(1);
    expect(await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE, "c29-suggest-happy")).toBe(1);
  });

  it("幂等重放返回同一引用，同键异载荷返回幂等冲突", async () => {
    const seeded = await seedSuggestion({ suffix: "replay", threshold: "9" });
    const suggestionsBefore = await suggestionRows();

    const replay = await fixture!.createSuggestion(seeded.command);
    expect(replay).toEqual({
      kind: "succeeded",
      result: {
        kind: "calibration",
        calibrationSuggestionRef: seeded.result.calibrationSuggestionRef,
        reviewTaskRef: seeded.result.reviewTaskRef,
      },
    });
    expect(await suggestionRows()).toEqual(suggestionsBefore);
    expect(await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE)).toBe(2);

    // 同键异载荷：C03 回执载荷摘要不一致必须判幂等冲突，且不产生第二行/第二个事件。
    const drift = await fixture!.createSuggestion({
      ...seeded.command,
      payload: {
        ...seeded.command.payload,
        agentTaskResultRef: {
          ...seeded.command.payload.agentTaskResultRef,
          validationRef: {
            kind: "validation-snapshot",
            reference: { entityId: "c29-idempotency-drift", versionId: "1" },
          },
        },
      },
    } as typeof seeded.command);
    expect(drift.kind).toBe("failed");
    if (drift.kind !== "failed") return;
    expect(drift.error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      category: "idempotency",
      retryable: false,
    });
    expect(await suggestionRows()).toEqual(suggestionsBefore);
    expect(
      (await deviationRows()).filter(
        (row) =>
          row.deviation_record_id === seeded.prepared.result.deviationRecordRef.reference.entityId,
      ),
    ).toHaveLength(1);
    expect(await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE)).toBe(2);
  });

  it("原子失败回滚：审计写入冲突后不留建议、记录与事件，重试成功", async () => {
    const staged = await prepareSuggestionCommand({ suffix: "rollback", threshold: "4" });
    const before = {
      suggestions: (await suggestionRows()).length,
      deviations: (await deviationRows()).length,
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    };
    const auditEntryId = "audit-c29-suggest-rollback:calibration-suggestion";
    await fixture!.preinsertAuditConflict(auditEntryId);

    const failed = await fixture!.createSuggestion(staged.command);
    expect(failed.kind).toBe("failed");
    expect({
      suggestions: (await suggestionRows()).length,
      deviations: (await deviationRows()).length,
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    }).toEqual(before);

    await fixture!.clearAuditConflict(auditEntryId);
    const retried = await fixture!.createSuggestion(staged.command);
    expect(retried.kind).toBe("succeeded");
    if (retried.kind !== "succeeded" || retried.result.kind !== "calibration") return;
    const retriedRows = await fixture!.rows<{ suggestion_id: string; status: string }>(
      `SELECT suggestion_id, status FROM business.calibration_suggestions
       WHERE project_id = $1 AND command_id = $2`,
      [fixture!.projectId, "c29-suggest-rollback"],
    );
    expect(retriedRows).toEqual([
      {
        suggestion_id: retried.result.calibrationSuggestionRef.reference.entityId,
        status: "pending-review",
      },
    ]);
    expect((await suggestionRows()).length).toBe(before.suggestions + 1);
    expect(await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE)).toBe(before.events + 1);
  });

  it("三类人工决定：拒绝追加版本、退回保留原版本、批准创建草案", async () => {
    const rejected = await seedSuggestion({ suffix: "reject", threshold: "5" });
    const returned = await seedSuggestion({ suffix: "return", threshold: "6" });
    const approved = await seedSuggestion({ suffix: "approve", threshold: "7" });
    const revisionsBefore = fixture!.governance.submitRevisions.length;

    /* 拒绝：追加 rejected 公共记录版本、建议标记 rejected，且不创建 C16 修订。 */
    const rejectDecision = await fixture!.decideReview({
      suffix: "reject",
      projectId: fixture!.projectId,
      targetRef: rejected.result.calibrationSuggestionRef,
      reviewTaskRef: rejected.result.reviewTaskRef,
      kind: "reject",
    });
    const rejectedOutcome = await fixture!.recordReviewOutcome(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-outcome-reject",
        outcome: "reject",
        suggestionRef: rejected.result.calibrationSuggestionRef,
        reviewDecisionRef: rejectDecision,
      }),
    );
    expect(rejectedOutcome).toMatchObject({ kind: "succeeded", result: { outcome: "rejected" } });
    const rejectedRecords = await rowsFor(rejected.result.deviationRecordRef.reference.entityId);
    expect(rejectedRecords.map((row) => [row.version_number, row.review_status])).toEqual([
      [1, "pending"],
      [2, "rejected"],
    ]);
    expect(rejectedRecords[1]!.review_decision_ref).toEqual(rejectDecision);
    const rejectedSuggestion = (await suggestionRows()).find(
      (row) => row.suggestion_id === rejected.result.calibrationSuggestionRef.reference.entityId,
    );
    expect(rejectedSuggestion).toMatchObject({
      status: "rejected",
      returned_decision_ref: null,
      approved_decision_ref: null,
    });
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore);

    /* 退回：公共记录保持第 1 版，退回关联记在建议行上。 */
    const returnDecision = await fixture!.decideReview({
      suffix: "return",
      projectId: fixture!.projectId,
      targetRef: returned.result.calibrationSuggestionRef,
      reviewTaskRef: returned.result.reviewTaskRef,
      kind: "return-for-revision",
    });
    const returnedOutcome = await fixture!.recordReviewOutcome(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-outcome-return",
        outcome: "return-for-revision",
        suggestionRef: returned.result.calibrationSuggestionRef,
        reviewDecisionRef: returnDecision,
      }),
    );
    expect(returnedOutcome).toMatchObject({
      kind: "succeeded",
      result: { outcome: "returned", deviationRecordVersionId: "1" },
    });
    expect(await rowsFor(returned.result.deviationRecordRef.reference.entityId)).toMatchObject([
      { version_number: 1, review_status: "pending" },
    ]);
    const returnedSuggestion = (await suggestionRows()).find(
      (row) => row.suggestion_id === returned.result.calibrationSuggestionRef.reference.entityId,
    );
    expect(returnedSuggestion).toMatchObject({ status: "returned" });
    expect(returnedSuggestion?.returned_decision_ref).toEqual(returnDecision);

    /* 批准：approve 只经草案路径；recordReviewOutcome 必须拒绝批准。 */
    const approveDecision = await fixture!.decideReview({
      suffix: "approve",
      projectId: fixture!.projectId,
      targetRef: approved.result.calibrationSuggestionRef,
      reviewTaskRef: approved.result.reviewTaskRef,
      kind: "approve-draft-creation",
    });
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-approve",
          outcome: "approve-draft-creation",
          suggestionRef: approved.result.calibrationSuggestionRef,
          reviewDecisionRef: approveDecision,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const draftsBefore = (await draftRows()).length;
    const draft = await fixture!.createGovernanceDraft(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-draft-approve",
        outcome: "approve-draft-creation",
        suggestionRef: approved.result.calibrationSuggestionRef,
        reviewDecisionRef: approveDecision,
      }),
    );
    expect(draft.kind).toBe("succeeded");
    if (draft.kind !== "succeeded") return;
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore + 1);
    const drafts = await draftRows();
    expect(drafts.length).toBe(draftsBefore + 1);
    const draftRow = drafts.find(
      (row) => row.draft_id === draft.result.governanceDraftRef.entityId,
    )!;
    expect({
      revisionId: draftRow.knowledge_revision_id,
      candidateArtifactId: draftRow.candidate_artifact_id,
    }).toEqual({
      revisionId: draft.result.knowledgeRevisionRef.reference.entityId,
      candidateArtifactId: draft.result.candidateArtifactRef.reference.entityId,
    });
    expect(
      (await rowsFor(approved.result.deviationRecordRef.reference.entityId)).map((row) => [
        row.version_number,
        row.review_status,
      ]),
    ).toEqual([
      [1, "pending"],
      [2, "approved"],
    ]);
    const approvedSuggestion = (await suggestionRows()).find(
      (row) => row.suggestion_id === approved.result.calibrationSuggestionRef.reference.entityId,
    );
    expect(approvedSuggestion).toMatchObject({ status: "approved-for-draft" });
    expect(approvedSuggestion?.approved_decision_ref).toEqual(approveDecision);

    // 候选工件是真实内容工件：用途码、正文与草案行的候选摘要一致。
    const candidateArtifacts = await fixture!.rows<{ purpose_code: string }>(
      `SELECT purpose_code FROM business.artifact_manifests
       WHERE project_id = $1 AND artifact_id = $2 AND version_id = $3`,
      [
        fixture!.projectId,
        draft.result.candidateArtifactRef.reference.entityId,
        draft.result.candidateArtifactRef.reference.versionId,
      ],
    );
    expect(candidateArtifacts).toEqual([{ purpose_code: C29_CANDIDATE_PURPOSE }]);
    const candidateDocument = AssessmentConfigurationDocumentV1Schema.parse(
      await fixture!.readArtifact(draft.result.candidateArtifactRef, C29_CANDIDATE_PURPOSE),
    );
    expect(candidateDocument.definitionType).toBe(fixture!.targetDefinitionType);
    expect(draftRow.candidate_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(draftRow.candidate_digest).toBe(
      (await suggestionRows()).find(
        (row) => row.suggestion_id === approved.result.calibrationSuggestionRef.reference.entityId,
      )?.candidate_digest,
    );

    // C16 提交只带精确基准发布、候选工件与证据，不声明发布或回滚。
    const submitted = fixture!.governance.submitRevisions.at(-1)!;
    expect({
      kind: submitted.kind,
      definitionType: submitted.payload.definitionType,
      baseReleaseRef: submitted.payload.baseReleaseRef,
      candidateArtifactRef: submitted.payload.candidateArtifactRef,
    }).toEqual({
      kind: "submit-revision",
      definitionType: fixture!.targetDefinitionType,
      baseReleaseRef: fixture!.targetReleaseRef,
      candidateArtifactRef: draft.result.candidateArtifactRef,
    });
    expect(submitted.payload.evidenceReferences.length).toBeGreaterThan(0);
  });

  it("无批准证明拒绝创建草案且不产生任何草案写入", async () => {
    const rejectedSuggestion = (await suggestionRows()).find((row) => row.status === "rejected")!;
    const suggestionRef: SuggestionRefV1 = {
      kind: "calibration-suggestion",
      reference: {
        entityId: rejectedSuggestion.suggestion_id,
        versionId: rejectedSuggestion.version_id,
      },
    };
    const recordedRow = (
      await fixture!.rows<{ review_decision_ref: unknown }>(
        `SELECT review_decision_ref FROM business.calibration_deviation_records
         WHERE project_id = $1 AND suggestion_id = $2 AND review_status = 'rejected'`,
        [fixture!.projectId, rejectedSuggestion.suggestion_id],
      )
    )[0]!;
    const snapshotBefore = {
      drafts: JSON.stringify(await draftRows()),
      deviations: JSON.stringify(await deviationRows()),
      suggestions: JSON.stringify(await suggestionRows()),
      revisions: fixture!.governance.submitRevisions.length,
    };

    // 非批准决定。
    expect(
      await fixture!.createGovernanceDraft(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-draft-with-reject",
          outcome: "approve-draft-creation",
          suggestionRef,
          reviewDecisionRef: recordedRow.review_decision_ref as never,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED", retryable: false } });

    // 决定不存在：仍然待复核的建议上提交未知决定引用，证明缺失必须先于任何写入关闭。
    const pendingSuggestion = (await suggestionRows()).find(
      (row) => row.status === "pending-review",
    )!;
    expect(
      await fixture!.createGovernanceDraft(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-draft-missing-decision",
          outcome: "approve-draft-creation",
          suggestionRef: {
            kind: "calibration-suggestion",
            reference: {
              entityId: pendingSuggestion.suggestion_id,
              versionId: pendingSuggestion.version_id,
            },
          },
          reviewDecisionRef: {
            kind: "review-decision",
            reference: { entityId: "c29-missing-decision", versionId: "1" },
          },
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "ENTITY_NOT_FOUND", retryable: false } });

    expect({
      drafts: JSON.stringify(await draftRows()),
      deviations: JSON.stringify(await deviationRows()),
      suggestions: JSON.stringify(await suggestionRows()),
      revisions: fixture!.governance.submitRevisions.length,
    }).toEqual(snapshotBefore);
  });

  it("草案重试不重复修订：C16 成功后事务失败再重试只留一项修订", async () => {
    const seeded = await seedSuggestion({ suffix: "draft-retry", threshold: "8" });
    const decision = await fixture!.decideReview({
      suffix: "draft-retry",
      projectId: fixture!.projectId,
      targetRef: seeded.result.calibrationSuggestionRef,
      reviewTaskRef: seeded.result.reviewTaskRef,
      kind: "approve-draft-creation",
    });
    const command = await fixture!.reviewOutcomeCommand({
      commandId: "c29-draft-retry",
      outcome: "approve-draft-creation",
      suggestionRef: seeded.result.calibrationSuggestionRef,
      reviewDecisionRef: decision,
    });
    const revisionsBefore = fixture!.governance.submitRevisions.length;

    // C16 已返回修订、C29 事务被审计冲突打断：草案与 approved 版本都不得成立。
    const auditEntryId = "audit-c29-draft-retry:calibration-governance-draft";
    await fixture!.preinsertAuditConflict(auditEntryId);
    const interrupted = await fixture!.createGovernanceDraft(command);
    expect(interrupted.kind).toBe("failed");
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore + 1);
    expect(
      (await draftRows()).filter((row) =>
        row.draft_id.includes(seeded.result.calibrationSuggestionRef.reference.entityId),
      ),
    ).toHaveLength(0);
    expect(
      (await rowsFor(seeded.prepared.result.deviationRecordRef.reference.entityId)).map(
        (row) => row.review_status,
      ),
    ).toEqual(["pending"]);

    await fixture!.clearAuditConflict(auditEntryId);
    const retried = await fixture!.createGovernanceDraft(command);
    expect(retried.kind).toBe("succeeded");
    if (retried.kind !== "succeeded") return;
    // 重试复用同一 C16 命令/幂等键：只登记一次 submit-revision，草案只留一行。
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore + 1);
    const finalDrafts = (await draftRows()).filter((row) =>
      row.draft_id.includes(seeded.result.calibrationSuggestionRef.reference.entityId),
    );
    expect(finalDrafts).toHaveLength(1);
    expect(finalDrafts[0]!.knowledge_revision_id).toBe(
      retried.result.knowledgeRevisionRef.reference.entityId,
    );
    expect(
      (await rowsFor(seeded.prepared.result.deviationRecordRef.reference.entityId)).map(
        (row) => row.review_status,
      ),
    ).toEqual(["pending", "approved"]);
  });

  it("跨工程决定不可枚举：与不存在决定产生同一失败形状", async () => {
    const suggestion = (await suggestionRows()).find((row) => row.status === "pending-review")!;
    const suggestionRef: SuggestionRefV1 = {
      kind: "calibration-suggestion",
      reference: { entityId: suggestion.suggestion_id, versionId: suggestion.version_id },
    };
    const foreignDecision = await fixture!.requestAndDecideForeignReview({
      suffix: "cross-project",
      projectId: "c29-project-other",
      kind: "approve-draft-creation",
    });
    const command = await fixture!.reviewOutcomeCommand({
      commandId: "c29-outcome-cross-project",
      outcome: "return-for-revision",
      suggestionRef,
      reviewDecisionRef: foreignDecision,
    });
    const foreign = await fixture!.recordReviewOutcome(command);
    const missing = await fixture!.recordReviewOutcome({
      ...command,
      payload: {
        ...command.payload,
        reviewDecisionRef: {
          kind: "review-decision",
          reference: { entityId: "c29-unknown-decision", versionId: "1" },
        },
      },
    });
    expect(foreign.kind).toBe("failed");
    expect(missing.kind).toBe("failed");
    if (foreign.kind !== "failed" || missing.kind !== "failed") return;
    expect(failureShape(foreign.error)).toEqual(failureShape(missing.error));
    expect(foreign.error).toMatchObject({
      code: "ENTITY_NOT_FOUND",
      category: "not-found",
      retryable: false,
    });
    expect((foreign.error as { targetRef?: unknown }).targetRef).toEqual(foreignDecision);
    expect((missing.error as { targetRef?: unknown }).targetRef).toEqual({
      kind: "review-decision",
      reference: { entityId: "c29-unknown-decision", versionId: "1" },
    });
    const after = (await suggestionRows()).find(
      (row) => row.suggestion_id === suggestion.suggestion_id,
    );
    expect(after).toEqual(suggestion);
    expect(C29_FIXTURE_TIME).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});
