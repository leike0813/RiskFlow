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

describe("C25 PostgreSQL risk assessment engine", () => {
  let fixture: RiskAssessmentEngineFixtureV1;
  let inputSnapshotRef: { readonly reference: { readonly entityId: string } };

  beforeAll(async () => {
    fixture = await startRiskAssessmentEngineFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.postgres.close();
  }, 60_000);

  it("prepare 物化 22 引用输入快照并逐项对上拥有方版本", async () => {
    const result = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare" })) as never,
    );
    expect(result).toMatchObject({ kind: "succeeded" });
    if (result.kind !== "succeeded") return;
    inputSnapshotRef = result.result.assessmentInputSnapshotRef;

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
    const payload = row.rows[0]!.snapshot_payload as Record<string, unknown>;
    expect(payload.preparationSnapshotRef).toMatchObject({
      reference: { entityId: fixture.preparationSnapshotRef.reference.entityId },
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

    // 同键异载荷：换用另一份同样可解析的准备快照，C03 回执摘要不同。
    const conflicting = await fixture.prepareCommand({
      commandId: "c25-prepare-replay",
      preparation: "b",
    });
    const third = await fixture.engine.prepare(conflicting as never);
    expect(third).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
  }, 120_000);

  it("越权与跨工程身份被不可重试拒绝且零副作用", async () => {
    const foreign = {
      ...(await fixture.prepareCommand({ commandId: "c25-prepare-foreign" })),
      projectId: fixture.foreignProjectId(),
    };
    // 公共 Schema 已把 command.projectId 与授权上下文绑定，跨工程身份在契约边界即被拒绝。
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
        previousAssessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: { entityId: "previous", versionId: "1" },
        },
      })) as never,
    );
    expect(result).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
  }, 120_000);

  it("产物摘要漂移时关闭失败", async () => {
    fixture.driftWeightSetDigest();
    try {
      const result = await fixture.engine.prepare(
        (await fixture.prepareCommand({ commandId: "c25-prepare-drift" })) as never,
      );
      expect(result).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    } finally {
      fixture.restoreBasis();
    }
  }, 120_000);

  it("evaluate 只消费冻结输入，监测序列覆盖不足时闭合且无正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare-for-evaluate" })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const result = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-evaluate",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    if (result.kind !== "failed") return;
    expect(JSON.stringify(result.error)).toContain("monitoring-snapshot-coverage");
    expect(
      await countRows(fixture, "business.indicator_actual_value_sets", fixture.projectId),
    ).toBe(0);
    expect(
      await countRows(fixture, "business.assessment_decision_artifacts", fixture.projectId),
    ).toBe(0);
    expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(0);
  }, 120_000);

  it("evaluate 在读事实前失败闭合：风险输入事实不可用时零正式事实", async () => {
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({ commandId: "c25-prepare-facts-gate" })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
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
        0,
      );
      expect(
        await countRows(fixture, "business.assessment_decision_artifacts", fixture.projectId),
      ).toBe(0);
    } finally {
      fixture.setFacts(undefined);
    }
  }, 120_000);
});
