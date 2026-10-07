/**
 * C29 PostgreSQL 纵向验收：真实迁移链 + C03 事务 + C04 内容寻址工件 + 真实 C06/C07/C08 + calibration adapter。
 * 每个用例都断言真实持久化事实（三表行、工件、回执、审计、Outbox）与真实适配器接缝，不锁定 SQL 顺序。
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationContextV1Schema, type ModuleErrorV1 } from "@riskflow/contracts/ports";
import { AssessmentConfigurationDocumentV1Schema } from "@riskflow/core/assessment-config";

import * as calibrationMigration from "../../src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000047_calibration_suggestion_governance.js";
import * as calibrationLineageMigration from "../../src/postgres/migrations/warning-response/deliver-calibration-suggestion-and-governance-loop/000048_calibration_suggestion_lineage.js";
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
  "calibration_suggestion_lineage_consumptions",
  "calibration_suggestion_lineage_reservations",
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
  readonly suggestion_id: string;
  readonly candidate_artifact_id: string;
  readonly candidate_digest: string;
  readonly knowledge_revision_id: string;
}

interface LineageReservationRowV1 {
  readonly reservation_id: string;
  readonly predecessor_suggestion_id: string;
  readonly predecessor_suggestion_version_id: string;
  readonly successor_suggestion_id: string;
  readonly successor_suggestion_version_id: string;
  readonly review_decision_id: string;
  readonly review_decision_version_id: string;
}

interface LineageConsumptionRowV1 {
  readonly reservation_id: string;
  readonly successor_suggestion_id: string;
  readonly successor_suggestion_version_id: string;
  readonly command_id: string;
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
  const lineageReservations = (): Promise<LineageReservationRowV1[]> =>
    fixture!.rows<LineageReservationRowV1>(
      `SELECT * FROM business.calibration_suggestion_lineage_reservations
       WHERE project_id = $1 ORDER BY reservation_id`,
      [fixture!.projectId],
    );
  const lineageConsumptions = (): Promise<LineageConsumptionRowV1[]> =>
    fixture!.rows<LineageConsumptionRowV1>(
      `SELECT * FROM business.calibration_suggestion_lineage_consumptions
       WHERE project_id = $1 ORDER BY reservation_id`,
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
    expect(
      result.kind,
      `createSuggestion(${input.suffix}): ${JSON.stringify(result).slice(0, 500)}`,
    ).toBe("succeeded");
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
      await calibrationLineageMigration.down(migrator.db);
      await calibrationMigration.down(migrator.db);
      const dropped = await fixture!.rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'business' AND table_name = ANY($1::text[])`,
        [[...CALIBRATION_TABLES]],
      );
      expect(dropped).toHaveLength(0);
      await calibrationMigration.up(migrator.db);
      await calibrationLineageMigration.up(migrator.db);
      await calibrationMigration.up(migrator.db);
      await calibrationLineageMigration.up(migrator.db);
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

  it("冻结快照缺失或目标版本不匹配时不保存校准输入", async () => {
    const fact = fixture!.deviationFacts.seed({
      suffix: "frozen-missing",
      thresholdExceeded: true,
    });
    const before = await artifactCount();
    fixture!.inputSnapshots.remove(fact.frozenAssessmentBasisRef.reference.entityId);
    const missing = await fixture!.prepareInput({
      requestId: "c29-prepare-frozen-missing",
      deviationFactRef: fact.deviationFactRef,
    });
    expect(missing).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await artifactCount()).toBe(before);
    const otherBasis = fixture!.deviationFacts.seed({
      suffix: "frozen-basis",
      thresholdExceeded: true,
    });
    const basisCommand = await fixture!.prepareCommand({
      requestId: "c29-prepare-frozen-basis",
      deviationFactRef: otherBasis.deviationFactRef,
    });
    const basisMismatch = await fixture!.calibration.prepareInput({
      ...basisCommand,
      basisReleaseSetRef: {
        ...basisCommand.basisReleaseSetRef,
        reference: { ...basisCommand.basisReleaseSetRef.reference, versionId: "other-valid" },
      },
    });
    expect(basisMismatch).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    expect(await artifactCount()).toBe(before);
    const otherScope = fixture!.deviationFacts.seed({
      suffix: "frozen-scope",
      thresholdExceeded: true,
    });
    fixture!.inputSnapshots.mismatchScope(otherScope.frozenAssessmentBasisRef.reference.entityId);
    const scopeMismatch = await fixture!.prepareInput({
      requestId: "c29-prepare-frozen-scope",
      deviationFactRef: otherScope.deviationFactRef,
    });
    expect(scopeMismatch).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    expect(await artifactCount()).toBe(before);
    const other = fixture!.deviationFacts.seed({
      suffix: "frozen-target",
      thresholdExceeded: true,
    });
    const command = await fixture!.prepareCommand({
      requestId: "c29-prepare-frozen-target",
      deviationFactRef: other.deviationFactRef,
      targetReleaseRef: {
        ...fixture!.targetReleaseRef,
        reference: { ...fixture!.targetReleaseRef.reference, versionId: "other" },
      },
    });
    const mismatch = await fixture!.calibration.prepareInput(command);
    expect(mismatch).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await artifactCount()).toBe(before);
    expect(fixture!.access.downstreamBranches).toContain("risk-assessment.read-input-snapshot");
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

  it("候选必须绑定任务冻结的输入快照", async () => {
    const fact = fixture!.deviationFacts.seed({
      suffix: "snapshot-mismatch",
      thresholdExceeded: true,
    });
    const prepared = await fixture!.prepareInput({
      requestId: "c29-prepare-snapshot-mismatch",
      deviationFactRef: fact.deviationFactRef,
    });
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") return;
    const task = await fixture!.runCalibrationTask({
      suffix: "snapshot-mismatch",
      frozenInputRef: prepared.result.frozenInputRef,
      inputSnapshotRef: {
        kind: "calibration-input-snapshot",
        reference: { entityId: "other-snapshot", versionId: "1" },
      },
      operations: fixture!.operations("3"),
    });
    const command = await fixture!.suggestionCommand({
      commandId: "c29-suggest-snapshot-mismatch",
      deviationRecordRef: prepared.result.deviationRecordRef,
      agentTaskResultRef: task.resultRef,
    });
    expect(await fixture!.createSuggestion(command)).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", retryable: false },
    });
  });

  it("冻结输入拒绝与执行策略不一致的校验策略引用", async () => {
    const fact = fixture!.deviationFacts.seed({
      suffix: "policy-mismatch",
      thresholdExceeded: true,
    });
    const command = await fixture!.prepareCommand({
      requestId: "c29-prepare-policy-mismatch",
      deviationFactRef: fact.deviationFactRef,
    });
    const readsBefore = fixture!.deviationFacts.readCalls.length;
    expect(
      await fixture!.calibration.prepareInput({
        ...command,
        calibrationValidationPolicyRef: { entityId: "other-policy", versionId: "1" },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    expect(fixture!.deviationFacts.readCalls).toHaveLength(readsBefore);
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

  it("已有 pending 建议但无退回预留时拒绝新任务消费且零写入", async () => {
    const seeded = await seedSuggestion({ suffix: "no-reservation", threshold: "9" });
    const task = await fixture!.runCalibrationTask({
      suffix: "no-reservation-second",
      frozenInputRef: seeded.prepared.result.frozenInputRef,
      inputSnapshotRef: seeded.prepared.result.inputSnapshotRef,
      operations: fixture!.operations("9.5"),
    });
    const command = await fixture!.suggestionCommand({
      commandId: "c29-suggest-no-reservation-second",
      deviationRecordRef: seeded.prepared.result.deviationRecordRef,
      agentTaskResultRef: task.resultRef,
    });
    const before = {
      suggestions: await suggestionRows(),
      deviations: await deviationRows(),
      reservations: await lineageReservations(),
      consumptions: await lineageConsumptions(),
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    };
    expect(await fixture!.createSuggestion(command)).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", retryable: false },
    });
    expect({
      suggestions: await suggestionRows(),
      deviations: await deviationRows(),
      reservations: await lineageReservations(),
      consumptions: await lineageConsumptions(),
      events: await fixture!.countEvents(C29_SUGGESTION_EVENT_TYPE),
    }).toEqual(before);
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

    /* 拒绝：追加 rejected 公共记录版本、建议行不可改写，且不创建 C16 修订。 */
    const rejectedRowBefore = JSON.stringify(
      (await suggestionRows()).find(
        (row) => row.suggestion_id === rejected.result.calibrationSuggestionRef.reference.entityId,
      ),
    );
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
    const rejectedRecords = await rowsFor(
      rejected.prepared.result.deviationRecordRef.reference.entityId,
    );
    expect(rejectedRecords.map((row) => [row.version_number, row.review_status])).toEqual([
      [1, "pending"],
      [2, "rejected"],
    ]);
    expect(rejectedRecords[1]!.review_decision_ref).toEqual(rejectDecision);
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore);
    // 三张校准表只允许 INSERT/SELECT：拒绝决定只追加记录版本，绝不改写建议行。
    expect(
      JSON.stringify(
        (await suggestionRows()).find(
          (row) =>
            row.suggestion_id === rejected.result.calibrationSuggestionRef.reference.entityId,
        ),
      ),
    ).toBe(rejectedRowBefore);
    // 可推进性来自追加链：同一建议上的第二个决定必须被拒绝。
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-reject-again",
          outcome: "reject",
          suggestionRef: rejected.result.calibrationSuggestionRef,
          reviewDecisionRef: rejectDecision,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED", retryable: false } });

    /* 退回：不追加记录版本，建议行保持原事实，决定经回执与审计可追溯。 */
    const returnedRowBefore = JSON.stringify(
      (await suggestionRows()).find(
        (row) => row.suggestion_id === returned.result.calibrationSuggestionRef.reference.entityId,
      ),
    );
    const returnDecision = await fixture!.decideReview({
      suffix: "return",
      projectId: fixture!.projectId,
      targetRef: returned.result.calibrationSuggestionRef,
      reviewTaskRef: returned.result.reviewTaskRef,
      kind: "return-for-revision",
    });
    const beforeWrongOutcome = {
      records: await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId),
      reservations: await lineageReservations(),
    };
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-return-as-reject",
          outcome: "reject",
          suggestionRef: returned.result.calibrationSuggestionRef,
          reviewDecisionRef: returnDecision,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect({
      records: await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId),
      reservations: await lineageReservations(),
    }).toEqual(beforeWrongOutcome);
    const returnCommand = await fixture!.reviewOutcomeCommand({
      commandId: "c29-outcome-return",
      outcome: "return-for-revision",
      suggestionRef: returned.result.calibrationSuggestionRef,
      reviewDecisionRef: returnDecision,
    });
    const returnedOutcome = await fixture!.recordReviewOutcome(returnCommand);
    expect(returnedOutcome).toMatchObject({
      kind: "succeeded",
      result: { outcome: "returned", deviationRecordVersionId: "2" },
    });
    expect(
      await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId),
    ).toMatchObject([
      { version_number: 1, review_status: "pending" },
      { version_number: 2, review_status: "pending" },
    ]);
    const reservation = (await lineageReservations()).find(
      (row) => row.review_decision_id === returnDecision.reference.entityId,
    )!;
    expect(reservation).toMatchObject({
      predecessor_suggestion_id: returned.result.calibrationSuggestionRef.reference.entityId,
      predecessor_suggestion_version_id:
        returned.result.calibrationSuggestionRef.reference.versionId,
      successor_suggestion_version_id: "2",
      review_decision_version_id: returnDecision.reference.versionId,
    });
    expect(await lineageConsumptions()).not.toContainEqual(
      expect.objectContaining({ reservation_id: reservation.reservation_id }),
    );
    const reservationRowsBeforeReplay = await lineageReservations();
    const deviationRowsBeforeReplay = await rowsFor(
      returned.prepared.result.deviationRecordRef.reference.entityId,
    );
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-return-replay",
          outcome: "return-for-revision",
          suggestionRef: returned.result.calibrationSuggestionRef,
          reviewDecisionRef: returnDecision,
        }),
      ),
    ).toMatchObject({ kind: "succeeded", result: { deviationRecordVersionId: "2" } });
    expect(await lineageReservations()).toEqual(reservationRowsBeforeReplay);
    expect(await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId)).toEqual(
      deviationRowsBeforeReplay,
    );

    const successorTask = await fixture!.runCalibrationTask({
      suffix: "return-v2",
      frozenInputRef: returned.prepared.result.frozenInputRef,
      inputSnapshotRef: returned.prepared.result.inputSnapshotRef,
      operations: fixture!.operations("6.5"),
    });
    const successorCommand = await fixture!.suggestionCommand({
      commandId: "c29-suggest-return-v2",
      deviationRecordRef: returned.prepared.result.deviationRecordRef,
      agentTaskResultRef: successorTask.resultRef,
    });
    const successor = await fixture!.createSuggestion(successorCommand);
    expect(successor).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "calibration",
        calibrationSuggestionRef: {
          reference: {
            entityId: reservation.successor_suggestion_id,
            versionId: reservation.successor_suggestion_version_id,
          },
        },
      },
    });
    expect(await lineageConsumptions()).toContainEqual(
      expect.objectContaining({
        reservation_id: reservation.reservation_id,
        successor_suggestion_id: reservation.successor_suggestion_id,
        successor_suggestion_version_id: reservation.successor_suggestion_version_id,
        command_id: "c29-suggest-return-v2",
      }),
    );
    expect(
      await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId),
    ).toHaveLength(2);
    expect(await fixture!.createSuggestion(successorCommand)).toEqual(successor);
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-return-after-consume",
          outcome: "return-for-revision",
          suggestionRef: returned.result.calibrationSuggestionRef,
          reviewDecisionRef: returnDecision,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    if (successor.kind !== "succeeded" || successor.result.kind !== "calibration") return;
    const successorRejectDecision = await fixture!.decideReview({
      suffix: "return-v2-reject",
      projectId: fixture!.projectId,
      targetRef: successor.result.calibrationSuggestionRef,
      reviewTaskRef: successor.result.reviewTaskRef,
      kind: "reject",
    });
    expect(
      await fixture!.recordReviewOutcome(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-outcome-return-v2-reject",
          outcome: "reject",
          suggestionRef: successor.result.calibrationSuggestionRef,
          reviewDecisionRef: successorRejectDecision,
        }),
      ),
    ).toMatchObject({
      kind: "succeeded",
      result: { outcome: "rejected", deviationRecordVersionId: "3" },
    });
    expect(
      (await rowsFor(returned.prepared.result.deviationRecordRef.reference.entityId)).map((row) => [
        row.version_number,
        row.review_status,
        row.record_payload.calibrationRecommendation,
      ]),
    ).toEqual([
      [1, "pending", returned.result.calibrationSuggestionRef.reference.entityId],
      [2, "pending", reservation.successor_suggestion_id],
      [3, "rejected", reservation.successor_suggestion_id],
    ]);
    expect(fixture!.governance.submitRevisions.length).toBe(revisionsBefore);
    expect(
      JSON.stringify(
        (await suggestionRows()).find(
          (row) =>
            row.suggestion_id === returned.result.calibrationSuggestionRef.reference.entityId,
        ),
      ),
    ).toBe(returnedRowBefore);
    const returnReceipt = (
      await fixture!.rows<{
        completed_at: string | null;
        audit_entry_id: string | null;
        result_ref: unknown;
      }>(
        `SELECT completed_at, audit_entry_id, result_ref FROM business.command_receipts
         WHERE project_id = $1 AND command_id = $2`,
        [fixture!.projectId, "c29-outcome-return"],
      )
    )[0]!;
    expect(returnReceipt.completed_at).not.toBeNull();
    expect(returnReceipt.audit_entry_id).toBe(
      "audit-c29-outcome-return:calibration-review-outcome",
    );
    expect(returnReceipt.result_ref).toEqual(returned.result.calibrationSuggestionRef);
    const returnAudit = (
      await fixture!.rows<{ action: string; target_ref: unknown; command_id: string }>(
        `SELECT action, target_ref, command_id FROM audit.entries WHERE audit_entry_id = $1`,
        ["audit-c29-outcome-return:calibration-review-outcome"],
      )
    )[0]!;
    expect(returnAudit).toMatchObject({
      action: "warning-response.record-calibration-review-outcome",
      command_id: "c29-outcome-return",
    });
    expect(returnAudit.target_ref).toEqual(returned.result.calibrationSuggestionRef);

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
    const approvedRowBefore = JSON.stringify(
      (await suggestionRows()).find(
        (row) => row.suggestion_id === approved.result.calibrationSuggestionRef.reference.entityId,
      ),
    );
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
      (await rowsFor(approved.prepared.result.deviationRecordRef.reference.entityId)).map((row) => [
        row.version_number,
        row.review_status,
      ]),
    ).toEqual([
      [1, "pending"],
      [2, "approved"],
    ]);
    // 草案成功同样只追加：建议行保持创建时事实，不被批准改写。
    expect(
      JSON.stringify(
        (await suggestionRows()).find(
          (row) =>
            row.suggestion_id === approved.result.calibrationSuggestionRef.reference.entityId,
        ),
      ),
    ).toBe(approvedRowBefore);

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
      commandId: submitted.commandId,
      idempotencyKey: submitted.idempotencyKey,
      definitionType: submitted.payload.definitionType,
      baseReleaseRef: submitted.payload.baseReleaseRef,
      candidateArtifactRef: submitted.payload.candidateArtifactRef,
    }).toEqual({
      kind: "submit-revision",
      commandId: "c29-draft-approve:submit-revision",
      idempotencyKey: "c29-draft-approve:submit-revision",
      definitionType: fixture!.targetDefinitionType,
      baseReleaseRef: fixture!.targetReleaseRef,
      candidateArtifactRef: draft.result.candidateArtifactRef,
    });
    expect(submitted.payload.evidenceReferences.length).toBeGreaterThan(0);
  });

  it("无批准证明拒绝创建草案且不产生任何草案写入", async () => {
    // 自足前置：本用例自己产生建议与非批准决定，不依赖其它用例留下的行状态。
    const seeded = await seedSuggestion({ suffix: "no-proof", threshold: "11" });
    const nonApprovalDecision = await fixture!.decideReview({
      suffix: "no-proof",
      projectId: fixture!.projectId,
      targetRef: seeded.result.calibrationSuggestionRef,
      reviewTaskRef: seeded.result.reviewTaskRef,
      kind: "return-for-revision",
    });
    const snapshotBefore = {
      drafts: JSON.stringify(await draftRows()),
      deviations: JSON.stringify(await deviationRows()),
      suggestions: JSON.stringify(await suggestionRows()),
      revisions: fixture!.governance.submitRevisions.length,
    };

    // 非批准决定：决定真实存在且精确绑定该建议，仍然不得创建草案。
    expect(
      await fixture!.createGovernanceDraft(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-draft-with-return",
          outcome: "approve-draft-creation",
          suggestionRef: seeded.result.calibrationSuggestionRef,
          reviewDecisionRef: nonApprovalDecision,
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED", retryable: false } });

    // 决定不存在：证明缺失必须先于任何写入关闭。
    expect(
      await fixture!.createGovernanceDraft(
        await fixture!.reviewOutcomeCommand({
          commandId: "c29-draft-missing-decision",
          outcome: "approve-draft-creation",
          suggestionRef: seeded.result.calibrationSuggestionRef,
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
      (await draftRows()).filter(
        (row) => row.suggestion_id === seeded.result.calibrationSuggestionRef.reference.entityId,
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
    const finalDrafts = (await draftRows()).filter(
      (row) => row.suggestion_id === seeded.result.calibrationSuggestionRef.reference.entityId,
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

  it("下游撤权在读取与草案副作用前失败，恢复后原命令身份收敛到单一草案", async () => {
    // 自足前置：本用例自己产生建议与真实批准决定；命令在撤权前已携带已签单分支上下文。
    const seeded = await seedSuggestion({ suffix: "draft-revoked", threshold: "9" });
    const decision = await fixture!.decideReview({
      suffix: "draft-revoked",
      projectId: fixture!.projectId,
      targetRef: seeded.result.calibrationSuggestionRef,
      reviewTaskRef: seeded.result.reviewTaskRef,
      kind: "approve-draft-creation",
    });
    const command = await fixture!.reviewOutcomeCommand({
      commandId: "c29-draft-revoked",
      outcome: "approve-draft-creation",
      suggestionRef: seeded.result.calibrationSuggestionRef,
      reviewDecisionRef: decision,
    });
    const snapshot = async () => ({
      drafts: JSON.stringify(await draftRows()),
      deviations: JSON.stringify(await deviationRows()),
      suggestions: JSON.stringify(await suggestionRows()),
      reservations: JSON.stringify(await lineageReservations()),
      revisions: fixture!.governance.submitRevisions.length,
    });
    const before = await snapshot();

    // 下游复验撤权：必须在读取证明与任何草案写入之前以稳定 AUTH 收口。
    fixture!.access.denyDownstream("review-audit.verify-calibration-suggestion-approval");
    let revoked:
      Awaited<ReturnType<CalibrationPostgresFixtureV1["createGovernanceDraft"]>> | undefined;
    try {
      revoked = await fixture!.createGovernanceDraft(command);
    } finally {
      fixture!.access.allow();
    }
    if (revoked === undefined) throw new Error("revoked governance draft did not return");
    expect(revoked).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED", category: "authorization", retryable: false },
    });
    expect(await snapshot()).toEqual(before);

    // 恢复同一授权后沿用原命令身份重试：只留一项 C16 修订与单一草案。
    const retried = await fixture!.createGovernanceDraft(command);
    expect(retried.kind).toBe("succeeded");
    if (retried.kind !== "succeeded") return;
    expect(fixture!.governance.submitRevisions.length).toBe(before.revisions + 1);
    const drafts = (await draftRows()).filter(
      (row) => row.suggestion_id === seeded.result.calibrationSuggestionRef.reference.entityId,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.knowledge_revision_id).toBe(
      retried.result.knowledgeRevisionRef.reference.entityId,
    );
    expect(
      (await rowsFor(seeded.prepared.result.deviationRecordRef.reference.entityId)).map(
        (row) => row.review_status,
      ),
    ).toEqual(["pending", "approved"]);
  });

  it("跨工程决定不可枚举：与不存在决定产生同一失败形状", async () => {
    // 自足前置：本用例自己的建议，保证追加链最新版本仍是 pending（可推进）。
    const seeded = await seedSuggestion({ suffix: "cross-project", threshold: "10" });
    const suggestion = (await suggestionRows()).find(
      (row) => row.suggestion_id === seeded.result.calibrationSuggestionRef.reference.entityId,
    )!;
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
  // ---------------------------------------------------------------- C34 校准窄读

  /** 基准偏差策略的登记标识：摘要里的 policyId 必须来自已登记基准，不是测试自造。 */
  const baseDeviationPolicyId = (): string =>
    (
      fixture!.baseDocument.content as {
        readonly policies: readonly { readonly policyId: string }[];
      }
    ).policies[0]!.policyId;

  /** 窄读输入一律走真实 C06 读分支签发：空间范围按该建议登记的偏差事实空间给出。 */
  const calibrationRead = async (input: {
    readonly invocationId: string;
    readonly suggestionRef: SuggestionRefV1;
    readonly scopeRef: {
      readonly kind: "spatial-scope";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly actorId?: string;
  }) =>
    fixture!.calibration.readCalibrationView({
      projectId: fixture!.projectId,
      actorId: input.actorId ?? fixture!.managerId,
      requestedAt: C29_FIXTURE_TIME,
      invocationId: input.invocationId,
      authorization: await fixture!.readAuthorization({
        invocationId: input.invocationId,
        spatialScopeRefs: [input.scopeRef],
      }),
      calibrationSuggestionRef: input.suggestionRef,
    });

  it("校准窄读按登记行投影目标、逐项校验与偏差记录版本，重复读取不新建事实", async () => {
    const seeded = await seedSuggestion({ suffix: "narrow-pending", threshold: "3" });
    const suggestionRef = seeded.result.calibrationSuggestionRef;
    const scopeRef = fixture!.rootScopeRef;
    const read = await calibrationRead({
      invocationId: "c29-narrow-pending-1",
      suggestionRef,
      scopeRef,
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") return;
    const view = read.view;
    expect(view.calibrationSuggestionRef).toEqual(suggestionRef);
    expect(view.targetKind).toBe(fixture!.targetDefinitionType);
    expect(view.targetReleaseRef.reference).toEqual(fixture!.targetReleaseRef.reference);
    expect(view.inputSnapshotRef.reference).toEqual(
      seeded.prepared.result.frozenInputRef.reference,
    );
    expect(view.validationPolicyRef).toEqual(fixture!.validationPolicy.policyRef);
    // 待复核建议的当前记录版本是第 1 版：公共状态由记录版本投影，不回读建议行初始值。
    expect(view.status).toBe("pending-review");
    // 逐项校验来自已登记候选与校验项：阈值操作按变更摘要给出，判定逐项一致。
    expect(view.operations).toEqual([
      {
        operation: {
          kind: "replace-deviation-policy",
          basis: "threshold",
          policyId: baseDeviationPolicyId(),
          threshold: "3",
        },
        valid: true,
      },
    ]);
    expect(view.reviewTaskRef).toEqual(seeded.result.reviewTaskRef);
    expect(view.deviationRecordRef.reference).toEqual(
      seeded.prepared.result.deviationRecordRef.reference,
    );
    expect(view.deviationRecordVersionId).toBe(
      (await rowsFor(seeded.prepared.result.deviationRecordRef.reference.entityId))[0]!.version_id,
    );
    // 未批准时不给决定与草案引用。
    expect(Object.keys(view)).not.toContain("reviewDecisionRef");
    expect(Object.keys(view)).not.toContain("candidateArtifactRef");
    expect(Object.keys(view)).not.toContain("knowledgeRevisionRef");

    const suggestionsBefore = (await suggestionRows()).length;
    const replay = await calibrationRead({
      invocationId: "c29-narrow-pending-2",
      suggestionRef,
      scopeRef,
    });
    expect(replay.kind).toBe("succeeded");
    if (replay.kind === "succeeded") expect(replay.view).toEqual(view);
    expect((await suggestionRows()).length).toBe(suggestionsBefore);
  });

  it("批准并创建草案后窄读给出决定与草案引用，草案仍是未发布修订", async () => {
    const seeded = await seedSuggestion({ suffix: "narrow-draft", threshold: "4" });
    const suggestionRef = seeded.result.calibrationSuggestionRef;
    const scopeRef = fixture!.rootScopeRef;
    const decision = await fixture!.decideReview({
      suffix: "narrow-draft",
      projectId: fixture!.projectId,
      targetRef: suggestionRef,
      reviewTaskRef: seeded.result.reviewTaskRef,
      kind: "approve-draft-creation",
    });
    const outcome = await fixture!.createGovernanceDraft(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-narrow-draft",
        outcome: "approve-draft-creation",
        suggestionRef,
        reviewDecisionRef: decision,
      }),
    );
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;

    const read = await calibrationRead({
      invocationId: "c29-narrow-draft-1",
      suggestionRef,
      scopeRef,
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") return;
    expect(read.view.reviewDecisionRef).toEqual(decision);
    expect(read.view.candidateArtifactRef).toEqual(outcome.result.candidateArtifactRef);
    expect(read.view.knowledgeRevisionRef).toEqual(outcome.result.knowledgeRevisionRef);
    // 草案只是未发布修订：公共读不给发布状态，也不给替代建议的新状态。
    expect(read.view.status).toBe("approved-for-draft");
  });

  it("拒绝决定记在偏差记录版本上，窄读按该版本的决定投影", async () => {
    const seeded = await seedSuggestion({ suffix: "narrow-reject", threshold: "5" });
    const suggestionRef = seeded.result.calibrationSuggestionRef;
    const decision = await fixture!.decideReview({
      suffix: "narrow-reject",
      projectId: fixture!.projectId,
      targetRef: suggestionRef,
      reviewTaskRef: seeded.result.reviewTaskRef,
      kind: "reject",
    });
    await fixture!.recordReviewOutcome(
      await fixture!.reviewOutcomeCommand({
        commandId: "c29-narrow-reject",
        outcome: "reject",
        suggestionRef,
        reviewDecisionRef: decision,
      }),
    );
    const read = await calibrationRead({
      invocationId: "c29-narrow-reject-1",
      suggestionRef,
      scopeRef: fixture!.rootScopeRef,
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") return;
    expect(read.view.reviewDecisionRef).toEqual(decision);
    // 拒绝只追加记录版本：当前状态由该版本给出。
    expect(read.view.status).toBe("rejected");
    // 拒绝不创建草案。
    expect(Object.keys(read.view)).not.toContain("candidateArtifactRef");
  });

  it("校准窄读的目标缺失、版本错配与主体错配都失败闭合", async () => {
    const seeded = await seedSuggestion({ suffix: "narrow-denied", threshold: "6" });
    const suggestionRef = seeded.result.calibrationSuggestionRef;
    const missing: SuggestionRefV1 = {
      kind: "calibration-suggestion",
      reference: { entityId: "c29-unknown-suggestion", versionId: "1" },
    };
    const absent = await calibrationRead({
      invocationId: "c29-narrow-denied-absent",
      suggestionRef: missing,
      scopeRef: fixture!.rootScopeRef,
    });
    // 目标存在但版本不是登记版本：与根本不存在返回同一形状，调用方无法据此枚举。
    const wrongVersion = await calibrationRead({
      invocationId: "c29-narrow-denied-version",
      suggestionRef: {
        kind: "calibration-suggestion",
        reference: {
          entityId: suggestionRef.reference.entityId,
          versionId: "c29-unknown-suggestion-version",
        },
      },
      scopeRef: fixture!.rootScopeRef,
    });
    expect(absent).toEqual({ kind: "failed", error: { code: "CALIBRATION_SUGGESTION_NOT_FOUND" } });
    expect(wrongVersion).toEqual(absent);
    const foreign = await calibrationRead({
      invocationId: "c29-narrow-denied-actor",
      suggestionRef,
      scopeRef: fixture!.rootScopeRef,
      actorId: "c29-narrow-denied-actor",
    });
    expect(foreign).toEqual({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  });
});
