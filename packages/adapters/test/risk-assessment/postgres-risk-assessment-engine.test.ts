import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  ActualAssessmentProofResultV1Schema,
  type ActualAssessmentProofResultV1,
  type AssessmentInputSnapshotRefV1,
  type AssessmentPreparationSnapshotRefV1,
  type AuthorizationContextV1,
  type RiskAssessmentReadQueryV1,
  type RiskAssessmentReadResultV1,
  type RiskAssessmentRecordRefV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import { RiskAssessmentRecordSchema } from "@riskflow/contracts/records";

import { c25ReleaseRef, c25RuntimePolicySet } from "../../../core/test/risk-assessment/fixture.js";

import { startRiskAssessmentEngineFixture, type RiskAssessmentEngineFixtureV1 } from "./fixture.js";

const countRows = async (
  fixture: RiskAssessmentEngineFixtureV1,
  table: string,
  projectId: string,
): Promise<number> => {
  const result = await fixture.postgres.postgres.adminPool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE project_id = $1`,
    [projectId],
  );
  return Number(result.rows[0]?.count ?? "0");
};

// 读取链路会为派生命令写自己的回执与审计，因此这里按命令 id 精确计数。
const countReceipts = async (fixture: RiskAssessmentEngineFixtureV1, commandId: string) => {
  const result = await fixture.postgres.postgres.adminPool.query<{ total: string }>(
    "SELECT count(*)::text AS total FROM business.command_receipts WHERE command_id = $1",
    [commandId],
  );
  return Number(result.rows[0]!.total);
};

const countAuditEntries = async (fixture: RiskAssessmentEngineFixtureV1, auditEntryId: string) => {
  const result = await fixture.postgres.postgres.adminPool.query<{ total: string }>(
    "SELECT count(*)::text AS total FROM audit.entries WHERE audit_entry_id = $1",
    [auditEntryId],
  );
  return Number(result.rows[0]!.total);
};

const countEvents = async (
  fixture: RiskAssessmentEngineFixtureV1,
  eventType: string,
): Promise<number> => {
  const result = await fixture.postgres.postgres.adminPool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM outbox.events WHERE event_type = $1",
    [eventType],
  );
  return Number(result.rows[0]?.count ?? "0");
};

describe("C25 PostgreSQL risk assessment engine", () => {
  let fixture: RiskAssessmentEngineFixtureV1;

  beforeAll(async () => {
    fixture = await startRiskAssessmentEngineFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.postgres.close();
  }, 60_000);

  /** 每个用例冻结自己的准备快照，使输入快照身份互不相同。 */
  const freshPreparation = async (suffix: string) =>
    fixture.freezePreparation({
      suffix,
      entryMode: "assess",
      triggerReasonCode: `test-${suffix}`,
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
    });

  it("prepare 物化 22 引用输入快照并逐项对上拥有方版本", async () => {
    const result = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare" })) as never,
    );
    expect(result).toMatchObject({ kind: "succeeded" });
    if (result.kind !== "succeeded") return;
    const inputSnapshotRef = result.result.assessmentInputSnapshotRef;

    const row = await fixture.postgres.postgres.adminPool.query<{
      reference_digest: string;
      entry_kind: string;
      snapshot_payload: Record<string, unknown>;
    }>(
      "SELECT reference_digest, entry_kind, snapshot_payload FROM business.assessment_input_snapshots WHERE input_snapshot_id = $1",
      [inputSnapshotRef.reference.entityId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.reference_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(row.rows[0]!.entry_kind).toBe("initial");
    const payload = row.rows[0]!.snapshot_payload;
    expect(payload.preparationSnapshotRef).toMatchObject({
      reference: { entityId: fixture.preparationRef("a").reference.entityId },
    });
    expect(payload.applicableRuleSetRef).toMatchObject({
      entityId: "release-set-applicable-rule-set",
    });
    expect(payload.warningAggregationPolicyRef).toMatchObject({
      entityId: "warning-aggregation-policy",
    });
    const referenceFields = Object.entries(payload).filter(
      ([key, value]) =>
        key.endsWith("Ref") &&
        typeof value === "object" &&
        value !== null &&
        "entityId" in (value as object),
    );
    expect(referenceFields).toHaveLength(22);
  }, 120_000);

  it("C25 精确窄读只返回冻结空间、依据和目标摘要", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare-calibration-read" })) as never,
    );
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") return;
    const requestId = "c25-read-calibration-input";
    const query = {
      requestId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      projectId: fixture.projectId,
      actorId: fixture.managerId,
      authorization: await fixture.readAuthorization(requestId),
      inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      targetReleaseRef: c25ReleaseRef("deviation-policy"),
    };
    const result = await fixture.engine.readInputSnapshot(query);
    expect(result).toMatchObject({
      kind: "succeeded",
      projectId: fixture.projectId,
      basisReleaseSetRef: fixture.basisRef,
      targetReleaseRef: query.targetReleaseRef,
      targetContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(result as object).not.toHaveProperty("snapshot_payload");
    const missing = await fixture.engine.readInputSnapshot({
      ...query,
      inputSnapshotRef: {
        ...query.inputSnapshotRef,
        reference: { ...query.inputSnapshotRef.reference, versionId: "missing" },
      },
    });
    expect(missing).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    const wrongTarget = await fixture.engine.readInputSnapshot({
      ...query,
      targetReleaseRef: c25ReleaseRef("other-definition"),
    });
    expect(wrongTarget).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    const foreign = await fixture.engine.readInputSnapshot({
      ...query,
      projectId: fixture.foreignProjectId(),
    });
    expect(foreign).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 120_000);

  it("同键同载荷重放返回原引用，同键异载荷返回幂等冲突", async () => {
    const command = (await fixture.prepareCommand({ commandId: "c25-prepare-replay" })) as never;
    const first = await fixture.engine.prepare(command);
    const second = await fixture.engine.prepare(command);
    expect(first).toMatchObject({ kind: "succeeded" });
    expect(second).toMatchObject({ kind: "succeeded" });
    if (first.kind !== "succeeded" || second.kind !== "succeeded") return;
    expect(second.result.assessmentInputSnapshotRef.reference.entityId).toBe(
      first.result.assessmentInputSnapshotRef.reference.entityId,
    );

    const conflicting = await fixture.prepareCommand({
      commandId: "c25-prepare-replay",
      preparation: fixture.preparationRef("b"),
    });
    const third = await fixture.engine.prepare(conflicting as never);
    expect(third).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
  }, 120_000);

  it("越权与跨工程身份被不可重试拒绝且零副作用", async () => {
    const foreign = {
      ...(await fixture.prepareCommand({ commandId: "c25-prepare-foreign" })),
      projectId: fixture.foreignProjectId(),
    };
    const result = await fixture.engine.prepare(foreign as never);
    expect(result).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", retryable: false },
    });
    expect(
      await countRows(fixture, "business.assessment_input_snapshots", fixture.foreignProjectId()),
    ).toBe(0);
  }, 120_000);

  it("重评分支与准备入口不一致时拒绝", async () => {
    const result = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-wrong-entry",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        previousAssessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: { entityId: "previous", versionId: "1" },
        },
      })) as never,
    );
    expect(result).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
  }, 120_000);

  it("evaluate 成功链：记录/决策工件/事件/审计/outbox 原子成立且可重放", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-success",
        preparation: await freshPreparation("success"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const inputSnapshotRef = prepared.result.assessmentInputSnapshotRef;

    const before = {
      valueSets: await countRows(
        fixture,
        "business.indicator_actual_value_sets",
        fixture.projectId,
      ),
      decisions: await countRows(
        fixture,
        "business.assessment_decision_artifacts",
        fixture.projectId,
      ),
      records: await countRows(fixture, "business.risk_assessment_records", fixture.projectId),
      events: await countEvents(fixture, "assessment.recorded.v1"),
      receipts: await countReceipts(fixture, "c25-evaluate-success"),
      auditEntries: await countAuditEntries(
        fixture,
        "audit-c25-evaluate-success:assessment-record",
      ),
    };

    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-success",
        inputSnapshotRef,
      })) as never,
    );
    expect(evaluated).toMatchObject({ kind: "succeeded" });
    if (evaluated.kind !== "succeeded") return;
    const { indicatorActualValueSetRef, assessmentDecisionArtifactRef, assessmentRecordRef } =
      evaluated.result;

    expect(
      await countRows(fixture, "business.indicator_actual_value_sets", fixture.projectId),
    ).toBe(before.valueSets + 1);
    expect(
      await countRows(fixture, "business.assessment_decision_artifacts", fixture.projectId),
    ).toBe(before.decisions + 1);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      before.records + 1,
    );
    expect(await countEvents(fixture, "assessment.recorded.v1")).toBe(before.events + 1);
    // 命令回执与审计是正式事实的一部分：直接查回执与审计行并断言其内容。
    expect(await countReceipts(fixture, "c25-evaluate-success")).toBe(before.receipts + 1);
    expect(await countAuditEntries(fixture, "audit-c25-evaluate-success:assessment-record")).toBe(
      before.auditEntries + 1,
    );
    const receipt = await fixture.postgres.postgres.adminPool.query<{
      command_kind: string;
      result_ref: { reference: { entityId: string; versionId: string } };
      completed_at: Date | null;
      event_ids: string[];
    }>(
      "SELECT command_kind, result_ref, completed_at, event_ids FROM business.command_receipts WHERE command_id = $1",
      ["c25-evaluate-success"],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]!.completed_at).not.toBeNull();
    expect(receipt.rows[0]!.command_kind).toBe("risk-assessment.record.v1");
    expect(receipt.rows[0]!.event_ids).toHaveLength(1);
    expect(receipt.rows[0]!.result_ref.reference).toEqual(assessmentRecordRef.reference);
    const auditEntry = await fixture.postgres.postgres.adminPool.query<{
      action: string;
      actor_ref: string;
      command_id: string;
      target_ref: { reference: { entityId: string } };
    }>(
      "SELECT action, actor_ref, command_id, target_ref FROM audit.entries WHERE audit_entry_id = $1",
      ["audit-c25-evaluate-success:assessment-record"],
    );
    expect(auditEntry.rows).toHaveLength(1);
    expect(auditEntry.rows[0]!.actor_ref).toBe(fixture.managerId);
    expect(auditEntry.rows[0]!.command_id).toBe("c25-evaluate-success");
    expect(auditEntry.rows[0]!.target_ref.reference.entityId).toBe(
      assessmentRecordRef.reference.entityId,
    );

    const record = await fixture.postgres.postgres.adminPool.query<{
      record_payload: {
        kind: string;
        likelihoodScore: number;
        consequenceScore: number;
        riskLevel: string;
        indicatorResults: readonly unknown[];
        triggerIndicators: readonly unknown[];
        audit: { actorId: string; recordedAt: string };
      };
      value_set_id: string;
      decision_id: string;
      content_artifact_version_id: string;
      identity_digest: string;
      audit_entry_id: string;
    }>(
      "SELECT record_payload, value_set_id, decision_id, decision_version_id, identity_digest, audit_entry_id FROM business.risk_assessment_records WHERE record_id = $1",
      [assessmentRecordRef.reference.entityId],
    );
    expect(record.rows).toHaveLength(1);
    const payload = record.rows[0]!.record_payload;
    expect(payload.indicatorResults).toHaveLength(3);
    // 持久化记录必须带公共契约的判别字段，并可由公共 Schema 解析。
    expect(payload.kind).toBe("standardized-risk-record");
    expect(RiskAssessmentRecordSchema.parse(payload).kind).toBe("standardized-risk-record");
    expect(payload.likelihoodScore).toBe(1.4);
    expect(payload.consequenceScore).toBe(3);
    expect(payload.riskLevel).toBe("level-2");
    expect(payload.triggerIndicators.length).toBeGreaterThan(0);
    // 审计主体与时间来自本次评估调用（C06 验证后的主体），不是准备阶段主体。
    expect(payload.audit.actorId).toBe(fixture.managerId);
    expect(record.rows[0]!.value_set_id).toBe(indicatorActualValueSetRef.reference.entityId);
    expect(record.rows[0]!.decision_id).toBe(assessmentDecisionArtifactRef.reference.entityId);
    expect(record.rows[0]!.identity_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.rows[0]!.audit_entry_id).toBe("audit-c25-evaluate-success:assessment-record");

    const decision = await fixture.postgres.postgres.adminPool.query<{
      content_artifact_version_id: string;
      content_digest: string;
    }>(
      "SELECT content_artifact_version_id, content_digest FROM business.assessment_decision_artifacts WHERE decision_id = $1",
      [assessmentDecisionArtifactRef.reference.entityId],
    );
    expect(decision.rows[0]!.content_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(decision.rows[0]!.content_artifact_version_id).toBe(
      `sha256:${decision.rows[0]!.content_digest}`,
    );

    // 重放：同一输入快照、换幂等身份仍然只产生一份正式事实。
    const replayed = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-success-replay",
        inputSnapshotRef,
      })) as never,
    );
    expect(replayed).toMatchObject({ kind: "succeeded" });
    if (replayed.kind !== "succeeded") return;
    expect(replayed.result.assessmentRecordRef.reference.entityId).toBe(
      assessmentRecordRef.reference.entityId,
    );
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      before.records + 1,
    );
  }, 180_000);

  it("并发评估同一输入快照观察到同一逻辑结果且只产生一份记录与一条事件", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-concurrency",
        preparation: await freshPreparation("concurrency"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const inputSnapshotRef = prepared.result.assessmentInputSnapshotRef;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    const eventsBefore = await countEvents(fixture, "assessment.recorded.v1");

    // 规格场景是同一幂等身份的并发重复：两次调用共享一个幂等键。
    const commands = await Promise.all(
      ["a", "b"].map(async (suffix) =>
        fixture.evaluateCommand({
          commandId: `c25-evaluate-concurrent-${suffix}`,
          idempotencyKey: "c25-evaluate-concurrent",
          inputSnapshotRef,
        }),
      ),
    );
    const results = await Promise.all(
      commands.map(async (command) => fixture.engine.evaluate(command as never)),
    );
    // 规格要求并发评估观察到同一逻辑结果：两次调用都必须成功且结果引用完全一致。
    for (const result of results) {
      expect(result.kind).toBe("succeeded");
    }
    const payloads = results.map((result) => (result as { result: unknown }).result);
    expect(payloads[0]).toEqual(payloads[1]);
    const recordIds = new Set(
      payloads.map(
        (payload) =>
          (payload as { assessmentRecordRef: { reference: { entityId: string } } })
            .assessmentRecordRef.reference.entityId,
      ),
    );
    expect(recordIds.size).toBe(1);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      recordsBefore + 1,
    );
    expect(await countEvents(fixture, "assessment.recorded.v1")).toBe(eventsBefore + 1);
  }, 180_000);

  it("事务成员失败时整体回滚：无值集/决策/记录/事件", async () => {
    const commandId = "c25-evaluate-rollback";
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-rollback",
        preparation: await freshPreparation("rollback"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const before = {
      valueSets: await countRows(
        fixture,
        "business.indicator_actual_value_sets",
        fixture.projectId,
      ),
      decisions: await countRows(
        fixture,
        "business.assessment_decision_artifacts",
        fixture.projectId,
      ),
      records: await countRows(fixture, "business.risk_assessment_records", fixture.projectId),
      events: await countEvents(fixture, "assessment.recorded.v1"),
      receipts: await countReceipts(fixture, commandId),
    };
    // 预置审计主键冲突：C03 在该事务内写审计时失败，整体回滚。
    await fixture.preinsertAuditConflict(commandId);
    // 基线取在注入之后：注入行本身不属于本次命令的新增事实。
    const auditBefore = await countAuditEntries(fixture, `audit-${commandId}:assessment-record`);
    const result = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId,
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(result.kind).toBe("failed");
    expect(
      await countRows(fixture, "business.indicator_actual_value_sets", fixture.projectId),
    ).toBe(before.valueSets);
    expect(
      await countRows(fixture, "business.assessment_decision_artifacts", fixture.projectId),
    ).toBe(before.decisions);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      before.records,
    );
    expect(await countEvents(fixture, "assessment.recorded.v1")).toBe(before.events);
    // 回执与审计同属事务成员：失败时不得留下任何新增行。
    expect(await countReceipts(fixture, commandId)).toBe(before.receipts);
    expect(await countAuditEntries(fixture, `audit-${commandId}:assessment-record`)).toBe(
      auditBefore,
    );
  }, 180_000);

  it("提交前 basis 摘要漂移时关闭失败且零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-recheck",
        preparation: await freshPreparation("recheck"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    fixture.driftBasisAfterFirstRead();
    try {
      const result = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: "c25-evaluate-recheck",
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(result).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
    } finally {
      fixture.restoreBasis();
    }
  }, 180_000);

  it("监测序列覆盖不足时闭合且无正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-coverage",
        preparation: fixture.preparationRef("b"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const before = {
      valueSets: await countRows(
        fixture,
        "business.indicator_actual_value_sets",
        fixture.projectId,
      ),
      decisions: await countRows(
        fixture,
        "business.assessment_decision_artifacts",
        fixture.projectId,
      ),
      records: await countRows(fixture, "business.risk_assessment_records", fixture.projectId),
    };
    const result = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-coverage",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    if (result.kind !== "failed") return;
    expect(JSON.stringify(result.error)).toContain("monitoring-snapshot-coverage");
    expect(
      await countRows(fixture, "business.indicator_actual_value_sets", fixture.projectId),
    ).toBe(before.valueSets);
    expect(
      await countRows(fixture, "business.assessment_decision_artifacts", fixture.projectId),
    ).toBe(before.decisions);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      before.records,
    );
  }, 180_000);

  it("evaluate 在读事实前失败闭合：风险输入事实不可用时零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-facts-gate",
        preparation: await freshPreparation("facts-gate"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    fixture.setFacts(undefined);
    try {
      const result = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: "c25-evaluate-no-facts",
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
    } finally {
      fixture.resetFacts();
    }
  }, 180_000);

  it("提交前授权失效时关闭失败且零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-revoked",
        preparation: await freshPreparation("revoked"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    // 失效注入点在读取之后、提交之前：风险事实读取返回时吊销会话。
    const command = await fixture.evaluateCommand({
      commandId: "c25-evaluate-revoked",
      inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
    });
    const receiptsBefore = await countReceipts(fixture, "c25-evaluate-revoked");
    const auditBefore = await countAuditEntries(
      fixture,
      "audit-c25-evaluate-revoked:assessment-record",
    );
    await fixture.revokeOnFactsRead();
    try {
      const result = await fixture.engine.evaluate(command as never);
      expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
      expect(await countReceipts(fixture, "c25-evaluate-revoked")).toBe(receiptsBefore);
      expect(await countAuditEntries(fixture, "audit-c25-evaluate-revoked:assessment-record")).toBe(
        auditBefore,
      );
    } finally {
      await fixture.restoreSession();
    }
  }, 180_000);

  it("提交前运行时策略版本漂移时关闭失败且零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-policy-drift",
        preparation: await freshPreparation("policy-drift"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const commandId = "c25-evaluate-policy-drift";
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    const receiptsBefore = await countReceipts(fixture, commandId);
    // 读取阶段拿到第一套策略，提交前复验必须发现版本已漂移。
    fixture.mutatePoliciesAfterFirstRead();
    try {
      const result = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId,
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(result).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
      expect(await countReceipts(fixture, commandId)).toBe(receiptsBefore);
    } finally {
      fixture.restorePolicies();
    }
  }, 180_000);

  it("下游授权未声明准备快照来源时读取关闭失败且零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-source-denied",
        preparation: await freshPreparation("source-denied"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    // 签发接缝不再转交声明的来源：C11 读取必须因来源不可读而关闭失败。
    fixture.denyDeclaredSources();
    try {
      const result = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: "c25-evaluate-source-denied",
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(result.kind).toBe("failed");
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
    } finally {
      fixture.restoreDeclaredSources();
    }
  }, 180_000);

  it("重评变更事件：纯新增只给新侧、纯删除只给前侧、替换两侧都给", async () => {
    const evaluatePreparation = async (suffix: string) => {
      const prepared = await fixture.engine.prepare(
        (await fixture.prepareCommand({
          commandId: `c25-change-${suffix}`,
          preparation: await freshPreparation(suffix),
        })) as never,
      );
      expect(prepared).toMatchObject({ kind: "succeeded" });
      if (prepared.kind !== "succeeded") throw new Error("prepare failed");
      const evaluated = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: `c25-change-${suffix}-evaluate`,
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(evaluated).toMatchObject({ kind: "succeeded" });
      if (evaluated.kind !== "succeeded") throw new Error("evaluate failed");
      return evaluated.result.assessmentRecordRef;
    };
    // 事件行按新契约解析，证明空侧省略与 min(1) 约束同时成立。
    const changeOf = async (commandId: string) => {
      const result = await fixture.postgres.postgres.adminPool.query<{ event_json: unknown }>(
        "SELECT event_json FROM outbox.events WHERE event_type = $1 AND producer_command_id = $2",
        ["engineering.assessment-input-changed.v1", commandId],
      );
      if (result.rows.length === 0) return undefined;
      // 用合并后的公共事件 Schema 解析：空侧省略与「至少一侧存在」约束都由此裁定。
      return DomainEventV1Schema.parse(result.rows[0]!.event_json).payload.change;
    };
    const reassess = async (
      suffix: string,
      input: {
        readonly reason: "monitoring-snapshot" | "weight-or-strategy";
        readonly monitoringSnapshotRefs?: typeof fixture.monitoringSnapshotRefs;
        readonly previous: unknown;
        readonly basisRef?: unknown;
      },
    ) =>
      fixture.engine.prepare(
        (await fixture.prepareCommand({
          commandId: `c25-change-${suffix}`,
          kind: "reassessment",
          reason: input.reason,
          preparation: await fixture.freezePreparation({
            suffix,
            entryMode: "reassess",
            triggerReasonCode: input.reason,
            ...(input.monitoringSnapshotRefs === undefined
              ? {}
              : { monitoringSnapshotRefs: input.monitoringSnapshotRefs }),
            previousAssessmentRecordRef: input.previous,
          }),
          ...(input.basisRef === undefined ? {} : { basisRef: input.basisRef }),
          previousAssessmentRecordRef: input.previous,
        })) as never,
      );

    const fullSet = fixture.monitoringSnapshotRefs;
    const settlementSwap = await fixture.extraMonitoringSnapshotRef();
    const baseRecord = await evaluatePreparation("base");
    // 准备快照内的引用按引用身份规范排序，事件两侧沿用同一顺序。
    const canonical = (
      refs: readonly {
        readonly kind: "monitoring-snapshot";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[],
    ) =>
      [...refs].sort((left, right) =>
        `${left.reference.entityId}@${left.reference.versionId}` <
        `${right.reference.entityId}@${right.reference.versionId}`
          ? -1
          : 1,
      );

    // 纯新增：前集合是后集合的真子集 ⇒ 只给新侧。
    const additionSet = [settlementSwap, ...fullSet];
    const added = await reassess("add", {
      reason: "monitoring-snapshot",
      monitoringSnapshotRefs: additionSet,
      previous: baseRecord,
    });
    expect(added).toMatchObject({ kind: "succeeded" });
    const additionChange = await changeOf("c25-change-add");
    expect(additionChange).toStrictEqual({
      kind: "monitoring-snapshot",
      newMonitoringSnapshotRefs: [settlementSwap],
    });
    expect("previousMonitoringSnapshotRefs" in additionChange!).toBe(false);

    // 纯删除（子集）：去掉一条 ⇒ 只给前侧，且只列被移除的引用。
    const subset = await reassess("delete", {
      reason: "monitoring-snapshot",
      monitoringSnapshotRefs: fullSet.slice(0, 2),
      previous: baseRecord,
    });
    expect(subset).toMatchObject({ kind: "succeeded" });
    expect(await changeOf("c25-change-delete")).toStrictEqual({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: [fullSet[2]!],
    });

    // 纯删除：清空监测引用 ⇒ 只给前侧。
    const cleared = await reassess("clear", {
      reason: "monitoring-snapshot",
      previous: baseRecord,
    });
    expect(cleared).toMatchObject({ kind: "succeeded" });
    const deletionChange = await changeOf("c25-change-clear");
    expect(deletionChange).toStrictEqual({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: canonical(fullSet),
    });
    expect("newMonitoringSnapshotRefs" in deletionChange!).toBe(false);

    // 替换：同时给两侧（各为被移除/被新增的引用）。
    const replacedSet = [settlementSwap, ...fullSet.slice(1)];
    const replaced = await reassess("replace", {
      reason: "monitoring-snapshot",
      monitoringSnapshotRefs: replacedSet,
      previous: baseRecord,
    });
    expect(replaced).toMatchObject({ kind: "succeeded" });
    expect(await changeOf("c25-change-replace")).toStrictEqual({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: [fullSet[0]!],
      newMonitoringSnapshotRefs: [settlementSwap],
    });

    // 集合与策略都未变化时必须闭合拒绝，而不是伪装成有效变更。
    const unchanged = await reassess("none", {
      reason: "monitoring-snapshot",
      monitoringSnapshotRefs: fullSet,
      previous: baseRecord,
    });
    expect(unchanged).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(JSON.stringify(unchanged)).toContain("change-not-observed");

    // 策略单独变化：监测集合不变，仅 scoring-strategy 版本变化 ⇒ 无变更事件。
    const variantBasisRef = await fixture.variantBasisRef();
    const strategyOnly = await reassess("strategy", {
      reason: "weight-or-strategy",
      monitoringSnapshotRefs: fullSet,
      previous: baseRecord,
      basisRef: variantBasisRef,
    });
    expect(strategyOnly).toMatchObject({ kind: "succeeded" });
    expect(await changeOf("c25-change-strategy")).toBeUndefined();
  }, 300_000);

  it("正式登记的外部风险事件走外部分支且与标准化记录互斥", async () => {
    const externalRef = await fixture.registerExternalRiskEvent("registered");
    const preparation = await fixture.freezePreparation({
      suffix: "external",
      entryMode: "assess",
      triggerReasonCode: "external-risk-event",
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
      riskInput: externalRef,
    });
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare-external", preparation })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-external",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluated).toMatchObject({ kind: "succeeded" });
    if (evaluated.kind !== "succeeded") return;

    const record = await fixture.postgres.postgres.adminPool.query<{
      record_payload: Record<string, unknown>;
      risk_input_kind: string;
      external_risk_event_id: string | null;
      risk_record_id: string | null;
    }>(
      "SELECT record_payload, risk_input_kind, external_risk_event_id, risk_record_id FROM business.risk_assessment_records WHERE record_id = $1",
      [evaluated.result.assessmentRecordRef.reference.entityId],
    );
    expect(record.rows[0]!.risk_input_kind).toBe("external-risk-event");
    expect(record.rows[0]!.risk_record_id).toBeNull();
    expect(record.rows[0]!.external_risk_event_id).toBe(externalRef.reference.entityId);
    expect(record.rows[0]!.record_payload).toMatchObject({
      kind: "external-risk-event",
      externalRiskEventId: externalRef.reference.entityId,
    });
    expect(RiskAssessmentRecordSchema.parse(record.rows[0]!.record_payload).kind).toBe(
      "external-risk-event",
    );
    expect("riskRecordId" in record.rows[0]!.record_payload).toBe(false);
  }, 180_000);

  it("未登记的外部风险事件在冻结准备快照时即闭合拒绝且零正式事实", async () => {
    const snapshotsBefore = await countRows(
      fixture,
      "business.assessment_input_snapshots",
      fixture.projectId,
    );
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    // 事实读取与 C11 冻结共用窄读：未登记的外部事件在冻结阶段就必须闭合。
    await expect(
      fixture.freezePreparation({
        suffix: "external-missing",
        entryMode: "assess",
        triggerReasonCode: "external-risk-event",
        monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
        riskInput: {
          kind: "external-risk-event",
          reference: { entityId: "external-risk-event-never-registered", versionId: "1" },
        },
      }),
    ).rejects.toThrow(/risk-assessment/i);
    expect(await countRows(fixture, "business.assessment_input_snapshots", fixture.projectId)).toBe(
      snapshotsBefore,
    );
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      recordsBefore,
    );
  }, 180_000);

  it("运行时策略缺失时读策略阶段闭合且零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-no-policy",
        preparation: await freshPreparation("no-policy"),
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const commandId = "c25-evaluate-no-policy";
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    const receiptsBefore = await countReceipts(fixture, commandId);
    fixture.setPolicies(undefined);
    try {
      const evaluated = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId,
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      expect(evaluated.kind).toBe("failed");
      if (evaluated.kind !== "failed") return;
      expect(JSON.stringify(evaluated.error)).toContain("policy");
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore,
      );
      expect(await countReceipts(fixture, commandId)).toBe(receiptsBefore);
    } finally {
      fixture.setPolicies(c25RuntimePolicySet({ projectId: fixture.projectId }));
    }
  }, 180_000);

  it("监测序列样本不足在计算前闭合且无正式事实", async () => {
    const fullSet = fixture.monitoringSnapshotRefs;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    // 同一水位序列的最新修订只有一个样本：特征不可用，评估必须在计算前闭合。
    const thinVariant = await fixture.seriesVariant({
      seriesId: "c25-series-water-level",
      seriesVersion: "2",
      canonicalUnit: "m",
      values: [10],
    });
    const preparation = await fixture.freezePreparation({
      suffix: "missing-value",
      entryMode: "assess",
      triggerReasonCode: "missing-value",
      monitoringSnapshotRefs: [fullSet[0]!, thinVariant, fullSet[2]!],
    });
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-missing-value",
        preparation,
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-missing-value",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluated.kind).toBe("failed");
    if (evaluated.kind !== "failed") return;
    expect(JSON.stringify(evaluated.error)).toMatch(/unavailable|coverage|missing/u);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      recordsBefore,
    );
  }, 240_000);

  it("监测序列单位与规则映射不一致时在计算前闭合且无正式事实", async () => {
    const fullSet = fixture.monitoringSnapshotRefs;
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    // 同一沉降序列的最新修订以米记录：斜率特征单位随之变化，与规则映射的 mm/s 冲突。
    const unitVariant = await fixture.seriesVariant({
      seriesId: "c25-series-settlement",
      seriesVersion: "2",
      canonicalUnit: "m",
      values: [5, 5.5, 6, 6.5, 7],
    });
    const preparation = await fixture.freezePreparation({
      suffix: "unit-conflict",
      entryMode: "assess",
      triggerReasonCode: "unit-conflict",
      monitoringSnapshotRefs: [unitVariant, ...fullSet.slice(1)],
    });
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-prepare-unit-conflict",
        preparation,
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate-unit-conflict",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluated.kind).toBe("failed");
    if (evaluated.kind !== "failed") return;
    expect(JSON.stringify(evaluated.error)).toContain("unit-conflict");
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      recordsBefore,
    );
  }, 240_000);

  it("历史回填以 effectiveAt 作为业务有效时点，审计仍用命令 issuedAt", async () => {
    const effectiveAt = "2029-12-01T00:00:00.000Z";
    const preparation = await fixture.freezePreparation({
      suffix: "backfill",
      entryMode: "historical-backfill",
      triggerReasonCode: "historical-backfill",
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
    });
    const command = await fixture.prepareCommand({
      commandId: "c25-prepare-backfill",
      kind: "historical-backfill",
      preparation,
      effectiveAt,
    });
    const result = await fixture.engine.prepare(command as never);
    expect(result).toMatchObject({ kind: "succeeded" });
    if (result.kind !== "succeeded") return;

    // 业务时点用于选择规则/策略版本：basis 与 runtime policy 都按 effectiveAt 读取。
    const times = fixture.lastReadTimes();
    expect(times.basisRequestedAt).toBe(effectiveAt);
    expect(times.policyRequiredAt).toBe(effectiveAt);

    // 审计发生时间仍是命令 issuedAt（夹具固定 2030-01-01T00:00:00.000Z）。
    const row = await fixture.postgres.postgres.adminPool.query<{
      effective_at: Date;
      entry_kind: string;
      occurred_at: Date;
    }>(
      "SELECT effective_at, entry_kind, occurred_at FROM business.assessment_input_snapshots WHERE input_snapshot_id = $1",
      [result.result.assessmentInputSnapshotRef.reference.entityId],
    );
    expect(row.rows[0]!.entry_kind).toBe("historical-backfill");
    expect(new Date(row.rows[0]!.effective_at).toISOString()).toBe(effectiveAt);
    expect(new Date(row.rows[0]!.occurred_at).toISOString()).toBe("2030-01-01T00:00:00.000Z");
  }, 180_000);

  // ---------------------------------------------------------- C25 精确评估只读证明

  const PROOF_REQUESTED_AT = "2030-01-01T00:00:00.000Z";

  /** 证明用例共用的已成立记录：惰性建立一次，后续用例只读（篡改用例自行复原）。 */
  let establishedProof:
    | {
        readonly recordRef: RiskAssessmentRecordRefV1;
        readonly inputSnapshotRef: AssessmentInputSnapshotRefV1;
        readonly preparationRef: AssessmentPreparationSnapshotRefV1;
      }
    | undefined;

  const establishedProofRecord = async () => {
    if (establishedProof === undefined) {
      const preparation = await freshPreparation("proof");
      const prepared = await fixture.engine.prepare(
        (await fixture.prepareCommand({
          commandId: "c25-proof-prepare",
          preparation,
        })) as never,
      );
      if (prepared.kind !== "succeeded") throw new Error("proof prepare failed");
      const evaluated = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: "c25-proof-evaluate",
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
      if (evaluated.kind !== "succeeded") throw new Error("proof evaluate failed");
      establishedProof = {
        recordRef: evaluated.result.assessmentRecordRef,
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        preparationRef: preparation,
      };
    }
    return establishedProof;
  };

  const proofQuery = (
    queryId: string,
    authorization: AuthorizationContextV1,
    riskAssessmentRecordRef: RiskAssessmentRecordRefV1,
  ) => ({
    queryId,
    requestedAt: PROOF_REQUESTED_AT,
    projectId: fixture.projectId,
    actorId: fixture.managerId,
    authorization,
    kind: "verify-actual-assessment" as const,
    payload: { riskAssessmentRecordRef },
  });

  const recordRowText = async (recordRef: RiskAssessmentRecordRefV1) => {
    const result = await fixture.postgres.postgres.adminPool.query<{
      content_digest: string;
      record_payload_text: string;
    }>(
      "SELECT content_digest, record_payload::text AS record_payload_text FROM business.risk_assessment_records WHERE record_id = $1 AND version_id = $2",
      [recordRef.reference.entityId, recordRef.reference.versionId],
    );
    return result.rows[0]!;
  };

  it("精确实际评估证明返回最小投影并逐项对上冻结输入", async () => {
    const { recordRef, inputSnapshotRef, preparationRef } = await establishedProofRecord();
    const queryId = "c25-proof-establish";
    const result = await fixture.engine.verifyActualAssessment(
      proofQuery(queryId, await fixture.readAuthorization(queryId), recordRef),
    );
    // 严格契约裁定投影形状：既不返回正文，也不多带任何字段。
    expect(ActualAssessmentProofResultV1Schema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ kind: "succeeded" });
    if (result.kind !== "succeeded") return;
    const proof = result.result;
    expect(Object.keys(proof).sort()).toEqual(
      [
        "assessmentBasisReleaseSetRef",
        "assessmentInputSnapshotRef",
        "assessmentRunRef",
        "auditTrailRef",
        "calibrationAgentPolicyRef",
        "deviationPolicyRef",
        "kind",
        "monitoringSnapshotRefs",
        "projectId",
        "recordedAt",
        "riskAssessmentRecordRef",
        "riskInputRef",
        "spatialScopeRef",
      ].sort(),
    );
    expect(proof.kind).toBe("established");
    expect(proof.projectId).toBe(fixture.projectId);
    expect(proof.riskAssessmentRecordRef).toEqual(recordRef);
    expect(proof.assessmentInputSnapshotRef).toEqual(inputSnapshotRef);
    expect(proof.assessmentBasisReleaseSetRef).toEqual(fixture.basisRef);
    expect(proof.assessmentRunRef).toEqual({
      kind: "workflow-run",
      reference: { entityId: "c25-engine-run", versionId: "1" },
    });

    // 逐项与 C25 持久事实对账：输入快照的策略、准备快照的空间/监测/风险输入、记录行的审计与时间。
    const inputSnapshotRow = await fixture.postgres.postgres.adminPool.query<{
      snapshot_payload: {
        deviationPolicyRef: unknown;
        calibrationAgentPolicyRef: unknown;
      };
    }>(
      "SELECT snapshot_payload FROM business.assessment_input_snapshots WHERE input_snapshot_id = $1 AND version_id = $2",
      [inputSnapshotRef.reference.entityId, inputSnapshotRef.reference.versionId],
    );
    expect(proof.deviationPolicyRef).toEqual(
      inputSnapshotRow.rows[0]!.snapshot_payload.deviationPolicyRef,
    );
    expect(proof.calibrationAgentPolicyRef).toEqual(
      inputSnapshotRow.rows[0]!.snapshot_payload.calibrationAgentPolicyRef,
    );
    const preparationRow = await fixture.postgres.postgres.adminPool.query<{
      snapshot_payload: {
        spatialScopeRef: unknown;
        riskInput: unknown;
        monitoringSnapshotRefs?: readonly unknown[];
      };
    }>(
      "SELECT snapshot_payload FROM business.assessment_preparation_snapshots WHERE snapshot_id = $1 AND version_id = $2",
      [preparationRef.reference.entityId, preparationRef.reference.versionId],
    );
    expect(proof.spatialScopeRef).toEqual(fixture.businessSpatialScopeRef);
    expect(proof.spatialScopeRef).toEqual(preparationRow.rows[0]!.snapshot_payload.spatialScopeRef);
    expect(proof.riskInputRef).toEqual(preparationRow.rows[0]!.snapshot_payload.riskInput);
    expect(proof.monitoringSnapshotRefs).toEqual(
      preparationRow.rows[0]!.snapshot_payload.monitoringSnapshotRefs,
    );
    const recordRow = await fixture.postgres.postgres.adminPool.query<{
      audit_entry_id: string;
      recorded_at: Date;
    }>(
      "SELECT audit_entry_id, recorded_at FROM business.risk_assessment_records WHERE record_id = $1 AND version_id = $2",
      [recordRef.reference.entityId, recordRef.reference.versionId],
    );
    expect(proof.auditTrailRef).toEqual({
      kind: "audit-trail",
      reference: { entityId: recordRow.rows[0]!.audit_entry_id, versionId: "1" },
    });
    expect(proof.recordedAt).toBe(new Date(recordRow.rows[0]!.recorded_at).toISOString());
  }, 180_000);

  it("缺失记录、错版本与失效授权以同型 AUTHORIZATION_DENIED 收口且不枚举存在性", async () => {
    const { recordRef } = await establishedProofRecord();
    // 目标在库中存在，但被查询的版本不存在：与完全未知目标必须不可区分。
    const existing = await fixture.postgres.postgres.adminPool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM business.risk_assessment_records WHERE record_id = $1",
      [recordRef.reference.entityId],
    );
    expect(existing.rows[0]!.count).toBe(1);

    const unknownId = "c25-proof-unknown-record";
    const hiddenQueryId = "c25-proof-hidden-version";
    const unknownQueryId = "c25-proof-unknown";
    const hidden = await fixture.engine.verifyActualAssessment(
      proofQuery(hiddenQueryId, await fixture.readAuthorization(hiddenQueryId), {
        ...recordRef,
        reference: { ...recordRef.reference, versionId: "999" },
      }),
    );
    const unknown = await fixture.engine.verifyActualAssessment(
      proofQuery(unknownQueryId, await fixture.readAuthorization(unknownQueryId), {
        kind: "risk-assessment-record",
        reference: { entityId: unknownId, versionId: "1" },
      }),
    );
    const revokedQueryId = "c25-proof-revoked";
    const revokedAuthorization = await fixture.readAuthorization(revokedQueryId);
    let revoked: ActualAssessmentProofResultV1;
    await fixture.revokeAfterFirstRead();
    try {
      revoked = await fixture.engine.verifyActualAssessment(
        proofQuery(revokedQueryId, revokedAuthorization, recordRef),
      );
    } finally {
      await fixture.restoreSession();
    }

    const shapeOf = (result: ActualAssessmentProofResultV1) => {
      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") throw new Error("expected a closed failure");
      expect(result.error.code).toBe("AUTHORIZATION_DENIED");
      if (result.error.code !== "AUTHORIZATION_DENIED") {
        throw new Error("expected an authorization denial");
      }
      return {
        category: result.error.category,
        retryable: result.error.retryable,
        requiredCapability: result.error.requiredCapability,
      };
    };
    const expected = {
      category: "authorization",
      retryable: false,
      requiredCapability: "risk-assessment.read",
    };
    expect(shapeOf(hidden)).toEqual(expected);
    expect(shapeOf(unknown)).toEqual(expected);
    expect(shapeOf(revoked)).toEqual(expected);
    // 响应不得回显被查询的引用，也不得泄露目标是否存在。
    expect(JSON.stringify(hidden)).not.toContain(recordRef.reference.entityId);
    expect(JSON.stringify(unknown)).not.toContain(unknownId);
    expect(Object.keys(hidden).sort()).toEqual(Object.keys(unknown).sort());
  }, 240_000);

  it("严格查询门：无权或跨工程请求在披露前被拒且零副作用", async () => {
    const { recordRef } = await establishedProofRecord();
    const queryId = "c25-proof-no-capability";
    const authorization = await fixture.readAuthorization(queryId);
    const noCapability = await fixture.engine.verifyActualAssessment(
      proofQuery(
        queryId,
        { ...authorization, grantedCapabilities: ["risk-assessment.evaluate"] },
        recordRef,
      ),
    );
    expect(noCapability).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", category: "technical", retryable: false },
    });
    const foreign = await fixture.engine.verifyActualAssessment({
      ...proofQuery(queryId, authorization, recordRef),
      projectId: fixture.foreignProjectId(),
    });
    expect(foreign).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", retryable: false },
    });
    // 披露前拒绝：连回执与业务审计都不产生。
    expect(await countReceipts(fixture, queryId)).toBe(0);
    expect(await countAuditEntries(fixture, `audit-${queryId}:assessment-record`)).toBe(0);
  }, 180_000);

  it("摘要或索引身份与正文不一致时终止失败且不改写历史", async () => {
    const { recordRef, inputSnapshotRef, preparationRef } = await establishedProofRecord();
    const queryId = "c25-proof-inconsistent";
    const query = proofQuery(queryId, await fixture.readAuthorization(queryId), recordRef);
    const original = await recordRowText(recordRef);

    // 摘要与正文不符。
    await fixture.postgres.postgres.adminPool.query(
      "UPDATE business.risk_assessment_records SET content_digest = $3 WHERE record_id = $1 AND version_id = $2",
      [recordRef.reference.entityId, recordRef.reference.versionId, "0".repeat(64)],
    );
    try {
      expect(await fixture.engine.verifyActualAssessment(query)).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE" },
      });
    } finally {
      await fixture.postgres.postgres.adminPool.query(
        "UPDATE business.risk_assessment_records SET content_digest = $3 WHERE record_id = $1 AND version_id = $2",
        [recordRef.reference.entityId, recordRef.reference.versionId, original.content_digest],
      );
    }

    // 摘要与正文自洽，但正文身份与行索引身份不符。
    const tampered = {
      ...(JSON.parse(original.record_payload_text) as Record<string, unknown>),
      assessmentRecordId: "c25-proof-tampered-record",
    };
    await fixture.postgres.postgres.adminPool.query(
      "UPDATE business.risk_assessment_records SET record_payload = $3::jsonb, content_digest = $4 WHERE record_id = $1 AND version_id = $2",
      [
        recordRef.reference.entityId,
        recordRef.reference.versionId,
        JSON.stringify(tampered),
        sha256CanonicalJson(tampered),
      ],
    );
    try {
      expect(await fixture.engine.verifyActualAssessment(query)).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE" },
      });
    } finally {
      await fixture.postgres.postgres.adminPool.query(
        "UPDATE business.risk_assessment_records SET record_payload = $3::jsonb, content_digest = $4 WHERE record_id = $1 AND version_id = $2",
        [
          recordRef.reference.entityId,
          recordRef.reference.versionId,
          original.record_payload_text,
          original.content_digest,
        ],
      );
    }

    // 输入快照行的准备快照引用与正文不符：冻结输入链不一致同样终止失败。
    const tamperedPreparationEntityId = "c25-proof-tampered-preparation";
    await fixture.postgres.postgres.adminPool.query(
      "UPDATE business.assessment_input_snapshots SET preparation_snapshot_ref = jsonb_set(preparation_snapshot_ref, '{reference,entityId}', to_jsonb($3::text)) WHERE input_snapshot_id = $1 AND version_id = $2",
      [
        inputSnapshotRef.reference.entityId,
        inputSnapshotRef.reference.versionId,
        tamperedPreparationEntityId,
      ],
    );
    try {
      expect(await fixture.engine.verifyActualAssessment(query)).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE" },
      });
    } finally {
      await fixture.postgres.postgres.adminPool.query(
        "UPDATE business.assessment_input_snapshots SET preparation_snapshot_ref = jsonb_set(preparation_snapshot_ref, '{reference,entityId}', to_jsonb($3::text)) WHERE input_snapshot_id = $1 AND version_id = $2",
        [
          inputSnapshotRef.reference.entityId,
          inputSnapshotRef.reference.versionId,
          preparationRef.reference.entityId,
        ],
      );
    }
  }, 240_000);

  it("证明只读：调用前后评估记录行与内容不变且不产生新事实", async () => {
    const { recordRef } = await establishedProofRecord();
    const rowKey = [recordRef.reference.entityId, recordRef.reference.versionId];
    const snapshot = async () =>
      (
        await fixture.postgres.postgres.adminPool.query<Record<string, unknown>>(
          "SELECT record_id, version_id, content_digest, identity_digest, record_payload, audit_entry_id, recorded_at FROM business.risk_assessment_records WHERE record_id = $1 AND version_id = $2",
          rowKey,
        )
      ).rows;
    const before = await snapshot();
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    const eventsBefore = await countEvents(fixture, "assessment.recorded.v1");

    const queryId = "c25-proof-readonly";
    const result = await fixture.engine.verifyActualAssessment(
      proofQuery(queryId, await fixture.readAuthorization(queryId), recordRef),
    );
    expect(result).toMatchObject({ kind: "succeeded" });

    expect(await snapshot()).toEqual(before);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
      recordsBefore,
    );
    expect(await countEvents(fixture, "assessment.recorded.v1")).toBe(eventsBefore);
    // 只读证明不登记回执、审计或新评估事实。
    expect(await countReceipts(fixture, queryId)).toBe(0);
    expect(await countAuditEntries(fixture, `audit-${queryId}:assessment-record`)).toBe(0);
  }, 180_000);

  // ---------------------------------------------------------------- C34 入口候选真实接缝

  const ENTRY_READ_AT = "2030-01-01T00:00:00.000Z";

  /**
   * 真实 C06→C11→C25 入口候选查询：`risk-assessment.read` 授权显式携带当前已验证空间与来源范围，
   * 与 C11 目录要求一致；不额外放宽调用方范围，也不在此处伪造来源授权。
   */
  const entryReadQuery = async (input: {
    readonly queryId: string;
    readonly payload: RiskAssessmentReadQueryV1["payload"];
    readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
  }): Promise<RiskAssessmentReadQueryV1> => ({
    queryId: input.queryId,
    projectId: fixture.projectId,
    actorId: fixture.managerId,
    requestedAt: ENTRY_READ_AT,
    authorization: await fixture.entryReadAuthorization(input.queryId, {
      spatialScopeRefs: input.spatialScopeRefs ?? [fixture.accessRootScopeRef],
      sourceVersionRefs: input.sourceVersionRefs ?? [fixture.sourceVersionRef],
    }),
    kind: "read",
    payload: input.payload,
  });

  const expectClosedAuthorizationDenied = (result: RiskAssessmentReadResultV1) => {
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("expected a closed read failure");
    expect(result.error).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
    });
  };

  /** 目录预览只读断言：业务目录、查询结果、业务审计与 Outbox 均不得新增。 */
  const catalogWriteCounts = async () => {
    const result = await fixture.postgres.postgres.adminPool.query<{
      snapshots: string;
      events: string;
      read_results: string;
      audit: string;
      outbox: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.applicability_metadata_snapshots WHERE project_id = $1) AS snapshots,
         (SELECT count(*)::text FROM business.external_risk_events WHERE project_id = $1) AS events,
         (SELECT count(*)::text FROM business.engineering_data_read_query_results WHERE project_id = $1) AS read_results,
         (SELECT count(*)::text FROM audit.entries WHERE project_id = $1) AS audit,
         (SELECT count(*)::text FROM outbox.events WHERE project_id = $1) AS outbox`,
      [fixture.projectId],
    );
    return result.rows[0]!;
  };

  it("entry-context 组合两类已登记目录：独立游标、按身份归一 C06 空间且预览零业务写入", async () => {
    await fixture.registerExternalRiskEvent("entry-catalog-a");
    await fixture.registerExternalRiskEvent("entry-catalog-b");
    await fixture.registerApplicabilitySnapshot("entry-catalog-2");

    // 入口候选 seam 只按 scope 身份（entityId）把业务空间引用归一到当前已验证的授权空间，
    // 不透传授权范围之外的空间，也不自行解析任何空间事实。
    expect(fixture.businessSpatialScopeRef.reference.entityId).toBe(
      fixture.accessRootScopeRef.reference.entityId,
    );

    const before = await catalogWriteCounts();

    const firstPage = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-context-1",
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
          pageSize: 1,
        },
      }),
    );
    expect(firstPage).toMatchObject({ kind: "succeeded", result: { kind: "entry-context" } });
    if (firstPage.kind !== "succeeded" || firstPage.result.kind !== "entry-context") return;
    expect(firstPage.result.actorId).toBe(fixture.managerId);
    expect(firstPage.result.projectId).toBe(fixture.projectId);
    expect(firstPage.result.projectRevisionRef).toEqual(fixture.projectRevisionRef);
    expect(firstPage.result.spatialScopeRef).toEqual(fixture.businessSpatialScopeRef);
    expect(firstPage.result.applicabilityItems).toHaveLength(1);
    expect(firstPage.result.externalEventItems).toHaveLength(1);
    expect(firstPage.result.applicabilityNextCursor).toBeDefined();
    expect(firstPage.result.externalEventNextCursor).toBeDefined();
    // 运行策略未注入：只给 unavailable，不伪造可用部署配置。
    expect(firstPage.result.runPolicy).toMatchObject({ kind: "unavailable" });
    const firstApplicabilityRef = JSON.stringify(
      firstPage.result.applicabilityItems[0]!.snapshotRef,
    );
    const firstExternalRef = JSON.stringify(firstPage.result.externalEventItems[0]!.riskInput);

    // 外部事件游标只推进外部事件目录；未传适用性游标时适用性目录保持首页。
    const externalSecond = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-context-external-2",
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
          pageSize: 1,
          externalEventCursor: firstPage.result.externalEventNextCursor,
        },
      }),
    );
    expect(externalSecond).toMatchObject({ kind: "succeeded" });
    if (externalSecond.kind !== "succeeded" || externalSecond.result.kind !== "entry-context")
      throw new Error("expected an entry-context external continuation");
    expect(externalSecond.result.externalEventItems).toHaveLength(1);
    expect(JSON.stringify(externalSecond.result.externalEventItems[0]!.riskInput)).not.toBe(
      firstExternalRef,
    );
    expect(JSON.stringify(externalSecond.result.applicabilityItems[0]!.snapshotRef)).toBe(
      firstApplicabilityRef,
    );

    // 适用性游标只推进适用性目录；未传外部事件游标时外部事件目录保持首页。
    const applicabilitySecond = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-context-applicability-2",
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
          pageSize: 1,
          applicabilityCursor: firstPage.result.applicabilityNextCursor,
        },
      }),
    );
    expect(applicabilitySecond).toMatchObject({ kind: "succeeded" });
    if (
      applicabilitySecond.kind !== "succeeded" ||
      applicabilitySecond.result.kind !== "entry-context"
    )
      throw new Error("expected an entry-context applicability continuation");
    expect(applicabilitySecond.result.applicabilityItems).toHaveLength(1);
    expect(JSON.stringify(applicabilitySecond.result.applicabilityItems[0]!.snapshotRef)).not.toBe(
      firstApplicabilityRef,
    );
    expect(JSON.stringify(applicabilitySecond.result.externalEventItems[0]!.riskInput)).toBe(
      firstExternalRef,
    );

    // 预览只读：契约目录、读取结果、业务审计与 Outbox 全部不增加。
    expect(await catalogWriteCounts()).toEqual(before);
  }, 240_000);

  it("pending-catalog 外部事件分支只提交空间即可读取，携带工程修订被严格拒绝", async () => {
    const registered = [
      await fixture.registerExternalRiskEvent("pending-external-a"),
      await fixture.registerExternalRiskEvent("pending-external-b"),
    ];
    const result = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-pending-external",
        payload: {
          operation: "pending-catalog",
          riskInputKind: "external-risk-event",
          spatialScopeRef: fixture.businessSpatialScopeRef,
        },
      }),
    );
    expect(result).toMatchObject({ kind: "succeeded", result: { kind: "pending-catalog" } });
    if (result.kind !== "succeeded" || result.result.kind !== "pending-catalog") return;
    const byId = new Map(
      result.result.items.map((item) => [item.riskInput.reference.entityId, item] as const),
    );
    for (const event of registered) {
      const item = byId.get(event.reference.entityId);
      expect(item).toBeDefined();
      expect(item!.assessmentState).toBe("unassessed");
      expect(item!.spatialScopeRefs).toEqual([fixture.businessSpatialScopeRef]);
    }

    // 严格输入：外部事件分支禁止工程修订字段，越界载荷在披露前被拒。
    const forged = await fixture.engine.read({
      ...(await entryReadQuery({
        queryId: "c25-pending-external-forged",
        payload: {
          operation: "pending-catalog",
          riskInputKind: "external-risk-event",
          spatialScopeRef: fixture.businessSpatialScopeRef,
        },
      })),
      payload: {
        operation: "pending-catalog",
        riskInputKind: "external-risk-event",
        spatialScopeRef: fixture.businessSpatialScopeRef,
        projectRevisionRef: fixture.projectRevisionRef,
      },
    } as never);
    expect(forged).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", category: "technical" },
    });
  }, 240_000);

  it("入口候选读：错空间、撤权与越界游标返回同型 AUTHORIZATION_DENIED 且零写入", async () => {
    const before = await catalogWriteCounts();

    // 载荷空间不在当前已验证空间身份内：披露前拒绝。
    const wrongScope = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-wrong-scope",
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: "scope-outside-c25", versionId: "1" },
          },
        },
      }),
    );
    expectClosedAuthorizationDenied(wrongScope);

    // 当前授权已撤销：读契约复验失败闭合，不当作空目录。
    const revokedQuery = await entryReadQuery({
      queryId: "c25-entry-revoked",
      payload: {
        operation: "entry-context",
        projectRevisionRef: fixture.projectRevisionRef,
        spatialScopeRef: fixture.businessSpatialScopeRef,
      },
    });
    await fixture.revokeAfterFirstRead();
    let revoked: RiskAssessmentReadResultV1 | undefined;
    try {
      revoked = await fixture.engine.read(revokedQuery);
    } finally {
      await fixture.restoreSession();
    }
    if (revoked === undefined) throw new Error("revoked entry read did not return");
    expectClosedAuthorizationDenied(revoked);

    // 越界游标：把外部事件目录游标用于适用性目录，C11 绑定不符后闭合拒绝。
    const externalPage = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-cursor-source",
        payload: {
          operation: "pending-catalog",
          riskInputKind: "external-risk-event",
          spatialScopeRef: fixture.businessSpatialScopeRef,
          pageSize: 1,
        },
      }),
    );
    expect(externalPage).toMatchObject({ kind: "succeeded" });
    if (externalPage.kind !== "succeeded" || externalPage.result.kind !== "pending-catalog") return;
    expect(externalPage.result.nextCursor).toBeDefined();
    const crossCursor = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-cross-cursor",
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
          pageSize: 1,
          applicabilityCursor: externalPage.result.nextCursor,
        },
      }),
    );
    expectClosedAuthorizationDenied(crossCursor);

    // 当前授权未携带任何来源授权：C11 只提供空来源集合，存在外部事件时仍安全失败而非空目录。
    const missingSource = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-entry-missing-source",
        sourceVersionRefs: [],
        payload: {
          operation: "entry-context",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
        },
      }),
    );
    expectClosedAuthorizationDenied(missingSource);

    // 失败的候选读同样零业务写入。
    expect(await catalogWriteCounts()).toEqual(before);
  }, 240_000);

  /** 复用 C25 原读取身份直接调用 C11 来源定位端口。 */
  const locatorQuery = (input: {
    readonly queryId: string;
    readonly authorization: AuthorizationContextV1;
  }) => ({
    queryId: input.queryId,
    projectId: fixture.projectId,
    actorId: fixture.managerId,
    requestedAt: ENTRY_READ_AT,
    authorization: input.authorization,
    kind: "read-assessment-entry-source-versions" as const,
    payload: { spatialScopeRef: fixture.businessSpatialScopeRef },
  });

  it("入口来源定位：无来源授权返回空范围、登记错配或缺失安全失败", async () => {
    // 无来源授权：C11 只按当前已验证 grant 定位，范围为空而非失败；
    // 但外部事件逐来源复验仍必须闭合拒绝，不能折算成空目录。
    await fixture.registerExternalRiskEvent("locator-empty-external");
    const noGrantQueryId = "c25-locator-empty";
    const emptyLocated = await fixture.postgres.registry.readAuthorizedSourceVersions(
      locatorQuery({
        queryId: noGrantQueryId,
        authorization: await fixture.entryReadAuthorization(noGrantQueryId, {
          spatialScopeRefs: [fixture.accessRootScopeRef],
          sourceVersionRefs: [],
        }),
      }),
    );
    expect(emptyLocated).toEqual({ kind: "succeeded", result: { sourceVersionRefs: [] } });
    const noGrantExternal = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-locator-empty-read",
        sourceVersionRefs: [],
        payload: {
          operation: "pending-catalog",
          riskInputKind: "external-risk-event",
          spatialScopeRef: fixture.businessSpatialScopeRef,
        },
      }),
    );
    expectClosedAuthorizationDenied(noGrantExternal);

    // 临时篡改 C11 自有 source_versions 登记，验证定位按错配/缺失安全失败并在 finally 复原。
    const row = (
      await fixture.postgres.postgres.adminPool.query<{
        source_version_id: string;
        version_id: string;
        source_version_ref: { reference: { versionId: string } };
      }>(
        "SELECT source_version_id, version_id, source_version_ref FROM business.source_versions WHERE project_id = $1 AND access_status = 'ready' ORDER BY source_version_id LIMIT 1",
        [fixture.projectId],
      )
    ).rows[0]!;
    const setSourceVersion = (versionId: string) =>
      fixture.postgres.postgres.adminPool.query(
        "UPDATE business.source_versions SET source_version_ref = jsonb_set(source_version_ref, '{reference,versionId}', to_jsonb($3::text)) WHERE source_version_id = $1 AND version_id = $2",
        [row.source_version_id, row.version_id, versionId],
      );
    // 000008 的 access_status/source_access_grant_ref 触发器只允许 pending-access→ready，
    // 因此临时停用该触发器把来源置回非就绪态，读取后必须复原。
    const setAccessStatus = async (status: "pending-access" | "ready") => {
      await fixture.postgres.postgres.adminPool.query(
        "ALTER TABLE business.source_versions DISABLE TRIGGER source_versions_access_transition",
      );
      try {
        await fixture.postgres.postgres.adminPool.query(
          "UPDATE business.source_versions SET access_status = $3 WHERE source_version_id = $1 AND version_id = $2",
          [row.source_version_id, row.version_id, status],
        );
      } finally {
        await fixture.postgres.postgres.adminPool.query(
          "ALTER TABLE business.source_versions ENABLE TRIGGER source_versions_access_transition",
        );
      }
    };
    const grantedQueryId = "c25-locator-corrupt";
    const grantedAuthorization = await fixture.entryReadAuthorization(grantedQueryId, {
      spatialScopeRefs: [fixture.accessRootScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });

    await setSourceVersion("c25-corrupt-source-version");
    try {
      expect(
        await fixture.postgres.registry.readAuthorizedSourceVersions(
          locatorQuery({ queryId: grantedQueryId, authorization: grantedAuthorization }),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      expectClosedAuthorizationDenied(
        await fixture.engine.read(
          await entryReadQuery({
            queryId: "c25-locator-corrupt-read",
            payload: {
              operation: "entry-context",
              projectRevisionRef: fixture.projectRevisionRef,
              spatialScopeRef: fixture.businessSpatialScopeRef,
            },
          }),
        ),
      );
    } finally {
      await setSourceVersion(row.source_version_ref.reference.versionId);
    }

    // 登记缺失：来源非就绪时定位按 0 行 ≠ 已授权项数安全失败，不把它折算成空范围。
    await setAccessStatus("pending-access");
    try {
      expect(
        await fixture.postgres.registry.readAuthorizedSourceVersions(
          locatorQuery({ queryId: grantedQueryId, authorization: grantedAuthorization }),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    } finally {
      await setAccessStatus("ready");
    }
  }, 240_000);
});
