import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

  it("重评变更事件：纯删除、替换、纯新增与策略单独变化", async () => {
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
    const changeEventOf = async (commandId: string) => {
      const result = await fixture.postgres.postgres.adminPool.query<{
        event_json: { payload: { change: Record<string, unknown>; reasonCode: string } };
      }>(
        "SELECT event_json FROM outbox.events WHERE event_type = $1 AND producer_command_id = $2",
        ["engineering.assessment-input-changed.v1", commandId],
      );
      return result.rows[0]?.event_json.payload;
    };

    const fullSet = fixture.monitoringSnapshotRefs;
    const sorted = (
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
    const settlementSwap = await fixture.extraMonitoringSnapshotRef();

    // 基准记录：完整 3 快照集合。
    const baseRecord = await evaluatePreparation("base");

    // 纯删除：新集合清空，事件新侧是真正的空集合。
    const cleared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-clear",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        preparation: await fixture.freezePreparation({
          suffix: "clear",
          entryMode: "reassess",
          triggerReasonCode: "monitoring-cleared",
          previousAssessmentRecordRef: baseRecord,
        }),
        previousAssessmentRecordRef: baseRecord,
      })) as never,
    );
    expect(cleared).toMatchObject({ kind: "succeeded" });
    const clearedEvent = await changeEventOf("c25-change-clear");
    expect(clearedEvent?.change).toMatchObject({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: sorted(fullSet),
      newMonitoringSnapshotRefs: [],
    });

    // 纯删除：新集合是基准集合的真子集。
    const deleted = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-delete",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        preparation: await fixture.freezePreparation({
          suffix: "delete",
          entryMode: "reassess",
          triggerReasonCode: "monitoring-deleted",
          monitoringSnapshotRefs: fullSet.slice(0, 2),
          previousAssessmentRecordRef: baseRecord,
        }),
        previousAssessmentRecordRef: baseRecord,
      })) as never,
    );
    expect(deleted).toMatchObject({ kind: "succeeded" });
    const deletion = await changeEventOf("c25-change-delete");
    expect(deletion?.change).toMatchObject({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: sorted(fullSet),
      newMonitoringSnapshotRefs: sorted(fullSet.slice(0, 2)),
    });

    // 替换：同一序列换成另一截止点快照。
    const replacedSet = [settlementSwap, ...fullSet.slice(1)];
    const replaced = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-replace",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        preparation: await fixture.freezePreparation({
          suffix: "replace",
          entryMode: "reassess",
          triggerReasonCode: "monitoring-replaced",
          monitoringSnapshotRefs: replacedSet,
          previousAssessmentRecordRef: baseRecord,
        }),
        previousAssessmentRecordRef: baseRecord,
      })) as never,
    );
    expect(replaced).toMatchObject({ kind: "succeeded" });
    const replacement = await changeEventOf("c25-change-replace");
    expect(replacement?.change).toMatchObject({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: sorted(fullSet),
      newMonitoringSnapshotRefs: sorted(replacedSet),
    });

    // 纯新增：以替换后的记录为前次，新集合是并集。
    // 以替换后的集合产生一份正式记录，作为纯新增用例的前次事实。
    const replacedPreparation = await fixture.freezePreparation({
      suffix: "replace-record",
      entryMode: "assess",
      triggerReasonCode: "monitoring-replaced-record",
      monitoringSnapshotRefs: replacedSet,
    });
    const replacedPrepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-replace-record",
        preparation: replacedPreparation,
      })) as never,
    );
    expect(replacedPrepared).toMatchObject({ kind: "succeeded" });
    if (replacedPrepared.kind !== "succeeded") return;
    const replacedEvaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-change-replace-record-evaluate",
        inputSnapshotRef: replacedPrepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(replacedEvaluated).toMatchObject({ kind: "succeeded" });
    if (replacedEvaluated.kind !== "succeeded") return;
    const replacedRecord = replacedEvaluated.result.assessmentRecordRef;
    const unionSet = [settlementSwap, ...fullSet];
    const added = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-add",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        preparation: await fixture.freezePreparation({
          suffix: "add",
          entryMode: "reassess",
          triggerReasonCode: "monitoring-added",
          monitoringSnapshotRefs: unionSet,
          previousAssessmentRecordRef: replacedRecord,
        }),
        previousAssessmentRecordRef: replacedRecord,
      })) as never,
    );
    expect(added).toMatchObject({ kind: "succeeded" });
    const addition = await changeEventOf("c25-change-add");
    expect(addition?.change).toMatchObject({
      kind: "monitoring-snapshot",
      previousMonitoringSnapshotRefs: sorted(replacedSet),
      newMonitoringSnapshotRefs: sorted(unionSet),
    });

    // 策略单独变化：监测集合不变，仅 scoring-strategy 版本变化。
    const variantBasisRef = await fixture.variantBasisRef();
    const strategyOnly = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-strategy",
        kind: "reassessment",
        reason: "weight-or-strategy",
        preparation: await fixture.freezePreparation({
          suffix: "strategy",
          entryMode: "reassess",
          triggerReasonCode: "scoring-strategy-changed",
          monitoringSnapshotRefs: fullSet,
          previousAssessmentRecordRef: baseRecord,
        }),
        basisRef: variantBasisRef,
        previousAssessmentRecordRef: baseRecord,
      })) as never,
    );
    expect(strategyOnly).toMatchObject({ kind: "succeeded" });
    expect(await changeEventOf("c25-change-strategy")).toBeUndefined();

    // 集合与策略都未变化时必须闭合拒绝，而不是伪装成有效变更。
    const unchanged = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-change-none",
        kind: "reassessment",
        reason: "monitoring-snapshot",
        preparation: await fixture.freezePreparation({
          suffix: "none",
          entryMode: "reassess",
          triggerReasonCode: "no-change",
          monitoringSnapshotRefs: fullSet,
          previousAssessmentRecordRef: baseRecord,
        }),
        previousAssessmentRecordRef: baseRecord,
      })) as never,
    );
    expect(unchanged).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(JSON.stringify(unchanged)).toContain("change-not-observed");
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
});
