import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { AccessServiceError } from "@riskflow/core/access";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  ActualAssessmentProofResultV1Schema,
  RiskDashboardAssessmentsSourceResultV1Schema,
  type ActualAssessmentProofResultV1,
  type AssessmentInputSnapshotRefV1,
  type AssessmentPreparationSnapshotRefV1,
  type AuthorizationContextV1,
  type RiskAssessmentReadQueryV1,
  type RiskAssessmentReadResultV1,
  type RiskAssessmentRecordRefV1,
  type RiskDashboardAssessmentsSourceRequestV1,
  type RiskDashboardAssessmentsSourceResultV1,
  type RiskDashboardTimelineAfterV1,
  type RiskDashboardTimelineEventV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import { RiskAssessmentRecordSchema } from "@riskflow/contracts/records";

import { c25ReleaseRef } from "../../../core/test/risk-assessment/fixture.js";
import { C25_FIXTURE_RISK_RECORD_REF } from "../../../core/test/risk-assessment/fixture.js";

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
  const freshPreparation = async (suffix: string, sourceFieldFacts?: unknown) =>
    fixture.freezePreparation({
      suffix,
      entryMode: "assess",
      triggerReasonCode: `test-${suffix}`,
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
      ...(sourceFieldFacts === undefined ? {} : { sourceFieldFacts }),
    });

  it("当前身份检查不携资料授权增量时仍按准备和实际输入权限评估", async () => {
    const preparation = await freshPreparation("current-evaluate-scope");
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-current-evaluate-prepare",
        preparation,
      })) as never,
    );
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") throw new Error("preparation required");
    const command = await fixture.evaluateCommand({
      commandId: "c25-current-evaluate",
      inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
    });
    const verify = fixture.postgres.access.verify.bind(fixture.postgres.access);
    const spy = vi.spyOn(fixture.postgres.access, "verify").mockImplementation(async (request) => {
      const decision = await verify(request);
      return request.branch === "risk-assessment.evaluate" &&
        request.requestedSourceVersionRefs.length === 0
        ? { ...decision, context: { ...decision.context, sourceAccessGrantRefs: [] } }
        : decision;
    });
    try {
      const result = await fixture.engine.evaluate(command as never);
      expect(result.kind).toBe("succeeded");
    } finally {
      spy.mockRestore();
    }
  });

  it("准备冻结的资料字段参与取值且不覆盖风险事实", async () => {
    // 识别 owner reader 只拥有风险标量（模型/综合置信度也在其中）：施工与地质取值只能来自准备。
    const field = (documentType: string, fieldPath: readonly string[], value: string | number) => ({
      documentType,
      fieldPath,
      value,
      evidenceReferences: [fixture.evidenceReference],
    });
    const riskOnlyFacts = (fields: readonly unknown[]) => ({
      schemaVersion: "1",
      projectId: fixture.projectId,
      riskInput: C25_FIXTURE_RISK_RECORD_REF,
      fields: [...fields],
      evidenceReferences: [fixture.evidenceReference],
    });
    const evaluate = async (suffix: string, preparation: unknown) => {
      const prepared = await fixture.engine.prepare(
        (await fixture.prepareCommand({
          commandId: `c25-prepare-${suffix}`,
          preparation: preparation as never,
        })) as never,
      );
      expect(prepared).toMatchObject({ kind: "succeeded" });
      if (prepared.kind !== "succeeded") throw new Error("preparation required");
      return fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: `c25-evaluate-${suffix}`,
          inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
        })) as never,
      );
    };
    const recordsBefore = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    try {
      // 原输入没有工程取值：不补充字段时按原指标映射闭合失败，任何置信度都不顶替。
      fixture.setFacts(
        riskOnlyFacts([
          field("standardized-risk-record", ["record", "riskSource"], "risk-source"),
          field("standardized-risk-record", ["record", "modelConfidence"], 0.42),
          field("standardized-risk-record", ["compositeConfidence", "value"], 0.88),
        ]),
      );
      const bare = await evaluate("risk-only", await freshPreparation("risk-only"));
      expect(bare).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(JSON.stringify(bare)).toContain("risk-assessment-indicator-missing");

      // 同一输入补充显式冻结的施工/地质字段：评估按既有确定性期望成立。
      const evaluated = await evaluate(
        "source-field-facts",
        await freshPreparation("source-field-facts", [
          field("geology-report", ["strata", "layer", "gradeIndex"], 2),
          field("design-report", ["support", "pressure"], 30),
        ]),
      );
      expect(evaluated).toMatchObject({ kind: "succeeded" });
      if (evaluated.kind !== "succeeded") return;
      const record = await fixture.postgres.postgres.adminPool.query<{
        record_payload: {
          likelihoodScore: number;
          consequenceScore: number;
          riskLevel: string;
        };
      }>("SELECT record_payload FROM business.risk_assessment_records WHERE record_id = $1", [
        evaluated.result.assessmentRecordRef.reference.entityId,
      ]);
      expect(record.rows[0]!.record_payload).toMatchObject({
        likelihoodScore: 1.4,
        consequenceScore: 3,
        riskLevel: "level-2",
      });

      // 重复键与总量越界：明确 BUSINESS_BLOCKED，既不覆盖风险字段也不静默截断。
      fixture.setFacts(
        riskOnlyFacts([field("geology-report", ["strata", "layer", "gradeIndex"], 2)]),
      );
      const conflicted = await evaluate(
        "field-conflict",
        await freshPreparation("field-conflict", [
          field("geology-report", ["strata", "layer", "gradeIndex"], 2),
        ]),
      );
      expect(conflicted).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(JSON.stringify(conflicted)).toContain("risk-input-facts-field-conflict");

      fixture.setFacts(
        riskOnlyFacts(
          Array.from({ length: 1024 }, (_, index) =>
            field("standardized-risk-record", ["record", `field-${index}`], index),
          ),
        ),
      );
      const overflowed = await evaluate(
        "field-overflow",
        await freshPreparation("field-overflow", [
          field("design-report", ["support", "pressure"], 30),
        ]),
      );
      expect(overflowed).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(JSON.stringify(overflowed)).toContain("risk-input-facts-overflow");
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        recordsBefore + 1,
      );
    } finally {
      fixture.resetFacts();
    }
  }, 180_000);

  it("checkpoint 证明精确输入/记录与准备绑定且不产生读取事实", async () => {
    const preparation = await freshPreparation("checkpoint");
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "c25-checkpoint-prepare",
        preparation,
      })) as never,
    );
    expect(prepared.kind).toBe("succeeded");
    if (prepared.kind !== "succeeded") return;
    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "c25-checkpoint-evaluate",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluated.kind).toBe("succeeded");
    if (evaluated.kind !== "succeeded") return;
    const invocationId = "c25-checkpoint-read";
    const input = {
      projectId: fixture.projectId,
      actorId: fixture.managerId,
      invocationId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await fixture.entryReadAuthorization(invocationId, {
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
      preparationSnapshotRef: preparation,
    };
    const counts = async () =>
      (
        await fixture.postgres.postgres.adminPool.query(`SELECT
      (SELECT count(*) FROM audit.entries) AS audits,
      (SELECT count(*) FROM business.command_receipts) AS receipts,
      (SELECT count(*) FROM business.artifact_manifests) AS artifacts,
      (SELECT count(*) FROM business.artifact_access_records) AS accesses,
      (SELECT count(*) FROM outbox.events) AS events`)
      ).rows[0];
    const before = await counts();
    for (const reference of [
      prepared.result.assessmentInputSnapshotRef,
      evaluated.result.assessmentRecordRef,
    ]) {
      expect(await fixture.engine.verifyCheckpointReference({ ...input, reference })).toBe(true);
      for (const overrides of [
        {
          reference: { ...reference, reference: { ...reference.reference, versionId: "missing" } },
        },
        { projectId: fixture.foreignProjectId() },
        { actorId: "another-actor" },
        {
          preparationSnapshotRef: {
            ...preparation,
            reference: { ...preparation.reference, versionId: "missing" },
          },
        },
      ])
        expect(
          await fixture.engine.verifyCheckpointReference({ ...input, reference, ...overrides }),
        ).toBe(false);
    }
    expect(
      await fixture.engine.verifyCheckpointReference({
        ...input,
        preparationSnapshotRef: undefined,
        reference: prepared.result.assessmentInputSnapshotRef,
      }),
    ).toBe(false);
    const recordRef = evaluated.result.assessmentRecordRef;
    const admin = fixture.postgres.postgres.adminPool;
    const stored = await admin.query<{ content_digest: string }>(
      "SELECT content_digest FROM business.risk_assessment_records WHERE record_id = $1 AND version_id = $2",
      [recordRef.reference.entityId, recordRef.reference.versionId],
    );
    await admin.query(
      "UPDATE business.risk_assessment_records SET content_digest = $3 WHERE record_id = $1 AND version_id = $2",
      [recordRef.reference.entityId, recordRef.reference.versionId, "f".repeat(64)],
    );
    try {
      expect(
        await fixture.engine.verifyCheckpointReference({ ...input, reference: recordRef }),
      ).toBe(false);
    } finally {
      await admin.query(
        "UPDATE business.risk_assessment_records SET content_digest = $3 WHERE record_id = $1 AND version_id = $2",
        [
          recordRef.reference.entityId,
          recordRef.reference.versionId,
          stored.rows[0]!.content_digest,
        ],
      );
    }
    expect(await counts()).toEqual(before);
  }, 120_000);

  it("prepare 仅冻结九项评分引用并逐项对上拥有方版本", async () => {
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
    expect(payload.schemaVersion).toBe("2");
    expect(payload).not.toHaveProperty("warningAggregationPolicyRef");
    expect(payload).not.toHaveProperty("deviationPolicyRef");
    const referenceFields = Object.entries(payload).filter(
      ([key, value]) =>
        key.endsWith("Ref") &&
        typeof value === "object" &&
        value !== null &&
        "entityId" in (value as object),
    );
    expect(referenceFields).toHaveLength(9);
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
      targetReleaseRef: c25ReleaseRef("weight-set"),
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

    // 历史评分依据按业务时点读取。
    const times = fixture.lastReadTimes();
    expect(times.basisRequestedAt).toBe(effectiveAt);

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
    fixture.setScoringConfigurationReady(false);
    try {
      const missing = await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-entry-context-missing-configuration",
          payload: {
            operation: "entry-context",
            projectRevisionRef: fixture.projectRevisionRef,
            spatialScopeRef: fixture.businessSpatialScopeRef,
            pageSize: 1,
          },
        }),
      );
      expect(missing).toMatchObject({
        kind: "succeeded",
        result: {
          preparationMissingKinds: ["scoring-configuration"],
        },
      });
      expect(await catalogWriteCounts()).toEqual(before);
    } finally {
      fixture.setScoringConfigurationReady(true);
    }
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
    await fixture.registerExternalRiskEvent("cursor-boundary-a");
    await fixture.registerExternalRiskEvent("cursor-boundary-b");
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

    // 页面尚未选择资料时，拥有来源权限的用户仍可读取服务端定位的业务目标。
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
    expect(missingSource.kind).toBe("succeeded");

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

  it("入口来源定位：空选择可继续按当前权限读取，登记错配或缺失明确失败", async () => {
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
    expect(noGrantExternal.kind).toBe("succeeded");

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

  // ---------------------------------------------------------------- C34 记录解释、重评历史与总览

  /** 跑通一次真实评估（冻结入口 → prepare → evaluate），返回评估记录的精确引用。 */
  const evaluateThrough = async (input: {
    readonly suffix: string;
    /** 风险输入覆盖：历史用例用独占风险记录，使该风险输入下只有本用例的记录。 */
    readonly riskInput?: {
      readonly kind: "standardized-risk-record";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly reassessment?: {
      readonly previousAssessmentRecordRef: RiskAssessmentRecordRefV1;
      /** 重评必须观察到真实输入变化：这里按「移除部分监测快照」制造删除侧变化。 */
      readonly monitoringSnapshotRefs: readonly {
        readonly kind: "monitoring-snapshot";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
    };
  }) => {
    const preparation = await fixture.freezePreparation({
      suffix: `read-${input.suffix}`,
      entryMode: input.reassessment === undefined ? "assess" : "reassess",
      triggerReasonCode:
        input.reassessment === undefined ? "manual-assessment" : "monitoring-snapshot",
      monitoringSnapshotRefs:
        input.reassessment?.monitoringSnapshotRefs ?? fixture.monitoringSnapshotRefs,
      ...(input.riskInput === undefined ? {} : { riskInput: input.riskInput }),
      ...(input.reassessment === undefined
        ? {}
        : { previousAssessmentRecordRef: input.reassessment.previousAssessmentRecordRef }),
    });
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: `c25-read-${input.suffix}`,
        ...(input.reassessment === undefined
          ? {}
          : {
              kind: "reassessment" as const,
              reason: "monitoring-snapshot" as const,
              previousAssessmentRecordRef: input.reassessment.previousAssessmentRecordRef,
            }),
        preparation,
      })) as never,
    );
    if (prepared.kind !== "succeeded") {
      throw new Error(`prepare failed: ${JSON.stringify(prepared).slice(0, 400)}`);
    }
    const evaluated = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: `c25-read-${input.suffix}-evaluate`,
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    if (evaluated.kind !== "succeeded") {
      throw new Error(`evaluate failed: ${JSON.stringify(evaluated).slice(0, 400)}`);
    }
    return {
      ...evaluated.result,
      inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
    };
  };

  /**
   * 合成只读历史行：按源行复制全部列并仅覆盖身份/摘要与授权范围键，生成批量 INSERT。
   * 只用于读取压力测量，不写命令回执，也不伪造任何成功写回。
   */
  const cloneSeedSql = async (input: {
    readonly table: string;
    readonly alias: string;
    readonly where: string;
    readonly overrides: Readonly<Record<string, string>>;
  }): Promise<string> => {
    const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const columns = await fixture.postgres.postgres.adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'business' AND table_name = $1 ORDER BY ordinal_position`,
      [input.table],
    );
    const names = columns.rows.map((row) => ident(row.column_name)).join(", ");
    const projected = columns.rows
      .map((row) => input.overrides[row.column_name] ?? `${input.alias}.${ident(row.column_name)}`)
      .join(", ");
    return `INSERT INTO business.${ident(input.table)} (${names})
            SELECT ${projected} FROM business.${ident(input.table)} ${input.alias}
            CROSS JOIN generate_series(1, 5001) n ${input.where}`;
  };

  it("记录目录按授权先过滤，50 项续页绑定筛选且摘要不截断", async () => {
    const assessed = await evaluateThrough({ suffix: "bounded-catalog" });
    const pool = fixture.postgres.postgres.adminPool;
    const sqlReads = vi.spyOn(fixture.postgres.runtime.db.getExecutor(), "executeQuery");
    const artifactReads = vi.spyOn(fixture.postgres.artifactStore, "open");
    const initialOverview = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-bound-before",
        payload: { operation: "overview", projectRevisionRef: fixture.projectRevisionRef },
      }),
    );
    if (initialOverview.kind !== "succeeded" || initialOverview.result.kind !== "overview")
      throw new Error("expected overview");
    const prep = await pool.query<{
      preparation_snapshot_id: string;
      preparation_snapshot_version_id: string;
    }>(
      `SELECT preparation_snapshot_id, preparation_snapshot_version_id
       FROM business.assessment_input_snapshots WHERE input_snapshot_id = $1 AND version_id = $2`,
      [assessed.inputSnapshotRef.reference.entityId, assessed.inputSnapshotRef.reference.versionId],
    );
    const preparationId = prep.rows[0]!.preparation_snapshot_id;
    const preparationVersion = prep.rows[0]!.preparation_snapshot_version_id;
    // 可见行共享同一份已核验决策工件，正式评估在上方真实完成；隐藏行另建准备快照并在来源证据中
    // 追加未授权来源，只能由 SQL 授权过滤排除，且排序键靠前——授权过滤若晚于分页，首页会被隐藏行占满。
    const visibleRecords = await cloneSeedSql({
      table: "risk_assessment_records",
      alias: "r",
      where: "WHERE r.record_id = $1",
      overrides: {
        record_id: "'bounded-copy-' || n::text",
        input_snapshot_id: "'bounded-input-' || n::text",
        identity_digest: "lpad(to_hex(n), 64, '0')",
      },
    });
    const visibleInputs = await cloneSeedSql({
      table: "assessment_input_snapshots",
      alias: "i",
      where: "WHERE i.input_snapshot_id = $1",
      overrides: {
        input_snapshot_id: "'bounded-input-' || n::text",
        reference_digest: "lpad(to_hex(n), 64, '0')",
      },
    });
    const hiddenPreparations = await cloneSeedSql({
      table: "assessment_preparation_snapshots",
      alias: "p",
      where: "WHERE p.snapshot_id = $1",
      overrides: {
        snapshot_id: "'bounded-hidden-prep-' || n::text",
        snapshot_payload: `jsonb_set(p.snapshot_payload, '{sourceEvidenceReferences}',
          (p.snapshot_payload -> 'sourceEvidenceReferences') || jsonb_build_array(
            jsonb_build_object('sourceVersion', jsonb_build_object(
              'entityId', 'bounded-hidden-source', 'versionId', '1'))))`,
      },
    });
    const hiddenInputs = await cloneSeedSql({
      table: "assessment_input_snapshots",
      alias: "i",
      where: "WHERE i.input_snapshot_id = $1",
      overrides: {
        input_snapshot_id: "'bounded-hidden-input-' || n::text",
        reference_digest: "lpad(to_hex(n + 100000), 64, '0')",
        preparation_snapshot_id: "'bounded-hidden-prep-' || n::text",
        preparation_snapshot_ref: `jsonb_build_object('kind', 'assessment-preparation-snapshot',
          'reference', jsonb_build_object('entityId', 'bounded-hidden-prep-' || n::text,
            'versionId', '${preparationVersion}'))`,
      },
    });
    const hiddenRecords = await cloneSeedSql({
      table: "risk_assessment_records",
      alias: "r",
      where: "WHERE r.record_id = $1",
      overrides: {
        record_id: "'bounded-hidden-' || n::text",
        input_snapshot_id: "'bounded-hidden-input-' || n::text",
        identity_digest: "lpad(to_hex(n + 100000), 64, '0')",
        occurred_at: "'2031-01-01T00:00:00.000Z'::timestamptz",
      },
    });
    try {
      await pool.query(visibleInputs, [assessed.inputSnapshotRef.reference.entityId]);
      await pool.query(visibleRecords, [assessed.assessmentRecordRef.reference.entityId]);
      await pool.query(hiddenPreparations, [preparationId]);
      await pool.query(hiddenInputs, [assessed.inputSnapshotRef.reference.entityId]);
      await pool.query(hiddenRecords, [assessed.assessmentRecordRef.reference.entityId]);
      const startedAt = performance.now();
      const first = await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-bound-first",
          payload: { operation: "record-catalog", pageSize: 50 },
        }),
      );
      if (first.kind !== "succeeded" || first.result.kind !== "record-catalog")
        throw new Error("expected catalog");
      expect(first.result.items).toHaveLength(50);
      expect(first.result.nextCursor).toBeDefined();
      const second = await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-bound-second",
          payload: { operation: "record-catalog", pageSize: 50, cursor: first.result.nextCursor },
        }),
      );
      if (second.kind !== "succeeded" || second.result.kind !== "record-catalog")
        throw new Error("expected next page");
      expect(second.result.items).toHaveLength(50);
      expect(
        new Set(
          [...first.result.items, ...second.result.items].map(
            (item) => item.assessmentRecordRef.reference.entityId,
          ),
        ).size,
      ).toBe(100);
      // 授权先过滤：返回页不含隐藏行；未加授权过滤时同一排序键的首页整页都是隐藏行。
      expect(
        first.result.items.every(
          (item) => !item.assessmentRecordRef.reference.entityId.startsWith("bounded-hidden-"),
        ),
      ).toBe(true);
      const unfilteredTop = await pool.query<{ hidden: string }>(
        `SELECT count(*)::text AS hidden FROM (
           SELECT record_id FROM business.risk_assessment_records
           WHERE project_id = $1 ORDER BY occurred_at DESC, record_id ASC, version_id ASC LIMIT 51
         ) page WHERE record_id LIKE 'bounded-hidden-%'`,
        [fixture.projectId],
      );
      expect(Number(unfilteredTop.rows[0]!.hidden)).toBe(51);
      expectClosedAuthorizationDenied(
        await fixture.engine.read(
          await entryReadQuery({
            queryId: "c25-bound-filter",
            payload: {
              operation: "record-catalog",
              entryMode: "reassess",
              cursor: first.result.nextCursor,
            },
          }),
        ),
      );
      expectClosedAuthorizationDenied(
        await fixture.engine.read(
          await entryReadQuery({
            queryId: "c25-bound-source",
            sourceVersionRefs: [],
            payload: { operation: "record-catalog", cursor: first.result.nextCursor },
          }),
        ),
      );
      const overview = await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-bound-overview",
          payload: { operation: "overview", projectRevisionRef: fixture.projectRevisionRef },
        }),
      );
      expect(overview).toMatchObject({
        kind: "succeeded",
        result: { recordedAssessmentCount: initialOverview.result.recordedAssessmentCount + 5001 },
      });
      const denied = await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-bound-no-source",
          sourceVersionRefs: [],
          payload: { operation: "overview", projectRevisionRef: fixture.projectRevisionRef },
        }),
      );
      expect(denied).toMatchObject({
        kind: "succeeded",
        result: { recordedAssessmentCount: initialOverview.result.recordedAssessmentCount + 5001 },
      });
      const sqlMeasurements = await Promise.all(
        sqlReads.mock.results.map(async (result, index) => {
          const query = sqlReads.mock.calls[index]![0];
          if (result.type !== "return" || !query.sql.includes('"risk_assessment_records" as "r"'))
            return null;
          return {
            rows: (await result.value).rows.length,
            paginated: query.sql.includes(" limit "),
          };
        }),
      );
      const recordQueries = sqlMeasurements.filter((item) => item !== null);
      const pageQueries = recordQueries.filter((query) => query.paginated);
      // 分页查询最多取 pageSize+1 行：多出的一行只用于判定 hasMore，不返回给调用方。
      expect(pageQueries.length).toBeGreaterThanOrEqual(2);
      expect(pageQueries.every((query) => query.rows <= 51)).toBe(true);
      const measurement = {
        records: 5001,
        unreadableRecords: 5001,
        pageRows: first.result.items.length,
        nextPageRows: second.result.items.length,
        recordQueries,
        artifactReadCount: artifactReads.mock.calls.length,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
      // 解释工件按返回页有界读取：不随隐藏行或库总量增长。
      expect(measurement.artifactReadCount).toBeLessThanOrEqual(50);
      console.info("C34 bounded read measurement", measurement);
      await writeFile(
        "/tmp/riskflow-c25-bounded-read-metrics.json",
        JSON.stringify(measurement, null, 2),
      );
    } finally {
      sqlReads.mockRestore();
      artifactReads.mockRestore();
      await pool.query(
        "DELETE FROM business.risk_assessment_records WHERE project_id = $1 AND record_id LIKE 'bounded-copy-%'",
        [fixture.projectId],
      );
      await pool.query(
        "DELETE FROM business.assessment_input_snapshots WHERE project_id = $1 AND input_snapshot_id LIKE 'bounded-input-%'",
        [fixture.projectId],
      );
      await pool.query(
        "DELETE FROM business.risk_assessment_records WHERE project_id = $1 AND record_id LIKE 'bounded-hidden-%'",
        [fixture.projectId],
      );
      await pool.query(
        "DELETE FROM business.assessment_input_snapshots WHERE project_id = $1 AND input_snapshot_id LIKE 'bounded-hidden-input-%'",
        [fixture.projectId],
      );
      await pool.query(
        "DELETE FROM business.assessment_preparation_snapshots WHERE project_id = $1 AND snapshot_id LIKE 'bounded-hidden-prep-%'",
        [fixture.projectId],
      );
    }
  }, 300_000);

  /** 记录行自有列的 P/C 与风险等级：目录摘要必须逐项对上，不从正文重算。 */
  const storedScores = async (recordRef: RiskAssessmentRecordRefV1) => {
    const rows = await fixture.postgres.postgres.adminPool.query<{
      likelihood_score_canonical: string;
      consequence_score_canonical: string;
      risk_level_id: string;
    }>(
      "SELECT likelihood_score_canonical, consequence_score_canonical, risk_level_id FROM business.risk_assessment_records WHERE project_id = $1 AND record_id = $2 AND version_id = $3",
      [fixture.projectId, recordRef.reference.entityId, recordRef.reference.versionId],
    );
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0]!;
  };

  /** 读取链路的解释失败闭合必须是业务阻断，而不是半份解释或空目录。 */
  const expectClosedBusinessBlocked = (result: RiskAssessmentReadResultV1, detailCode: string) => {
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("expected a closed read failure");
    expect(result.error).toMatchObject({
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      blockerRef: { reference: { entityId: expect.stringContaining(`:${detailCode}`) } },
    });
  };

  /** 已登记评估记录的三张正式事实行整体文本，用于证明读取不改写历史版本。 */
  const storedFactsText = async (recordRef: RiskAssessmentRecordRefV1) => {
    const rows = await fixture.postgres.postgres.adminPool.query<{ facts: string }>(
      `SELECT jsonb_build_object(
                'record', to_jsonb(r.record_payload),
                'record_digest', to_jsonb(r.identity_digest),
                'value_set', to_jsonb(v.value_set_payload),
                'decision_ref', to_jsonb(d.content_artifact_ref),
                'decision_digest', to_jsonb(d.content_digest)
              )::text AS facts
         FROM business.risk_assessment_records r
         JOIN business.indicator_actual_value_sets v
           ON v.project_id = r.project_id AND v.value_set_id = r.value_set_id
          AND v.version_id = r.value_set_version_id
         JOIN business.assessment_decision_artifacts d
           ON d.project_id = r.project_id AND d.decision_id = r.decision_id
          AND d.version_id = r.decision_version_id
        WHERE r.project_id = $1 AND r.record_id = $2 AND r.version_id = $3`,
      [fixture.projectId, recordRef.reference.entityId, recordRef.reference.versionId],
    );
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0]!.facts;
  };

  it("记录目录给出摘要与冻结落点，精确记录逐项对上保存的规则、轴、触发与配置引用", async () => {
    const assessed = await evaluateThrough({ suffix: "catalog-a" });
    await fixture.registerAssessmentRun({
      suffix: "catalog-a",
      runId: "c25-read-run:assess",
      recordRef: assessed.assessmentRecordRef,
      entryMode: "assess",
    });
    const factsBefore = await storedFactsText(assessed.assessmentRecordRef);
    const scores = await storedScores(assessed.assessmentRecordRef);

    const emptyIncrementQuery = await entryReadQuery({
      queryId: "c25-record-empty-increment",
      sourceVersionRefs: [],
      payload: { operation: "record-read", assessmentRecordRef: assessed.assessmentRecordRef },
    });
    expect(emptyIncrementQuery.authorization.sourceAccessGrantRefs).toEqual([]);
    expect(
      await fixture.postgres.access.filterVisibleSources!({
        branch: "risk-assessment.read",
        authorization: emptyIncrementQuery.authorization,
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
    ).toEqual([fixture.sourceVersionRef]);
    await expect(
      fixture.postgres.access.filterVisibleSources!({
        authorization: emptyIncrementQuery.authorization,
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    const emptyIncrementRead = await fixture.engine.read(emptyIncrementQuery);
    expect(emptyIncrementRead, JSON.stringify(emptyIncrementRead)).toMatchObject({
      kind: "succeeded",
      result: { kind: "record-read", assessmentRecordRef: assessed.assessmentRecordRef },
    });

    const catalog = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-catalog",
        payload: { operation: "record-catalog" },
      }),
    );
    expect(catalog).toMatchObject({ kind: "succeeded", result: { kind: "record-catalog" } });
    if (catalog.kind !== "succeeded" || catalog.result.kind !== "record-catalog")
      throw new Error("expected a record-catalog page");
    const item = catalog.result.items.find(
      (entry) =>
        entry.assessmentRecordRef.reference.entityId ===
        assessed.assessmentRecordRef.reference.entityId,
    );
    expect(item).toBeDefined();
    // 风险输入的精确版本只登记在准备快照上：目录条目必须原样带出，不得补空版本。
    expect(item!.riskInput).toEqual(C25_FIXTURE_RISK_RECORD_REF);
    expect(item!.entryMode).toBe("assess");
    expect(item!.previousAssessmentRecordRef).toBeUndefined();
    expect(item!.likelihoodScore).toBe(Number(scores.likelihood_score_canonical));
    expect(item!.consequenceScore).toBe(Number(scores.consequence_score_canonical));
    expect(item!.riskState).toBe(scores.risk_level_id);
    // 矩阵落点来自保存的决策工件：分带、等级与序号都不在目录侧重算。
    expect(item!.matrixPlot.riskMatrixRef.entityId).toContain("risk-matrix");
    expect(item!.matrixPlot.riskLevelId).toBe(scores.risk_level_id);
    expect(item!.matrixPlot.riskLevelOrdinal).toBeGreaterThan(0);
    expect(catalog.result.actions).toContainEqual({
      branch: "risk-assessment.reassessment",
      availability: "allowed",
    });

    // 入口方式、空间与矩阵版本是三类独立筛选；不匹配时返回空目录而不是全量。
    const byEntryMode = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-catalog-reassess",
        payload: { operation: "record-catalog", entryMode: "reassess" },
      }),
    );
    expect(byEntryMode).toMatchObject({ kind: "succeeded", result: { items: [] } });

    const byMatrixVersion = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-catalog-matrix",
        payload: {
          operation: "record-catalog",
          riskMatrixVersion: item!.matrixPlot.riskMatrixRef,
        },
      }),
    );
    expect(byMatrixVersion).toMatchObject({ kind: "succeeded" });
    if (byMatrixVersion.kind !== "succeeded" || byMatrixVersion.result.kind !== "record-catalog")
      throw new Error("expected a matrix-filtered catalog page");
    expect(
      byMatrixVersion.result.items.some(
        (entry) =>
          entry.assessmentRecordRef.reference.entityId ===
          assessed.assessmentRecordRef.reference.entityId,
      ),
    ).toBe(true);

    const byForeignMatrix = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-catalog-matrix-foreign",
        payload: {
          operation: "record-catalog",
          riskMatrixVersion: { entityId: "risk-matrix-not-in-use", versionId: "1" },
        },
      }),
    );
    expect(byForeignMatrix).toMatchObject({ kind: "succeeded", result: { items: [] } });

    const byScope = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-catalog-scope",
        payload: { operation: "record-catalog", spatialScopeRef: fixture.businessSpatialScopeRef },
      }),
    );
    expect(byScope).toMatchObject({ kind: "succeeded" });
    if (byScope.kind !== "succeeded" || byScope.result.kind !== "record-catalog")
      throw new Error("expected a scope-filtered catalog page");
    expect(
      byScope.result.items.some(
        (entry) =>
          entry.assessmentRecordRef.reference.entityId ===
          assessed.assessmentRecordRef.reference.entityId,
      ),
    ).toBe(true);

    // 精确记录：实际值来自保存的实际值集，规则/等级/基准分来自同记录的决策工件。
    const recordRead = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-record-read",
        payload: {
          operation: "record-read",
          assessmentRecordRef: assessed.assessmentRecordRef,
        },
      }),
    );
    expect(recordRead).toMatchObject({ kind: "succeeded", result: { kind: "record-read" } });
    if (recordRead.kind !== "succeeded" || recordRead.result.kind !== "record-read")
      throw new Error("expected a record-read view");
    const view = recordRead.result;
    expect(view.actorId).toBe(fixture.managerId);
    expect(view.assessmentRecordRef).toEqual(assessed.assessmentRecordRef);
    expect(view.record.riskLevel).toBe(scores.risk_level_id);
    expect(view.entryMode).toBe("assess");
    expect(view.inputSnapshotRef.reference.entityId).toBe(
      assessed.inputSnapshotRef.reference.entityId,
    );
    expect(view.matrixPlot).toEqual(item!.matrixPlot);
    // 七项配置原引用逐项来自决策工件，客户端不推导。
    expect(Object.keys(view.configurationRefs).sort()).toEqual([
      "indicatorFieldMappingRef",
      "indicatorSystemRef",
      "jointTriggerPolicyRef",
      "monitoringWarningThresholdRef",
      "riskAcceptanceThresholdRef",
      "scoringStrategyRef",
      "weightSetRef",
    ]);
    expect(view.indicators.length).toBeGreaterThan(0);
    for (const explanation of view.indicators) {
      expect(explanation.ruleId).toMatch(/^/u);
      expect(explanation.grade.length).toBeGreaterThan(0);
      expect(explanation.sourceReferences.length).toBeGreaterThan(0);
    }
    expect(view.axes.possibility.contributions.length).toBeGreaterThan(0);
    expect(view.axes.possibility.weightSetRef).toEqual(view.configurationRefs.weightSetRef);
    expect(view.triggerFacts.length).toBeGreaterThan(0);
    expect(view.auditTrailRef.reference.entityId).toBe(
      `audit-c25-read-catalog-a-evaluate:assessment-record`,
    );
    expect(view.actions).toContainEqual({
      branch: "risk-assessment.reassessment",
      availability: "allowed",
    });

    // 读取不改写历史：记录、实际值集与决策工件三张事实行整体不变。
    expect(await storedFactsText(assessed.assessmentRecordRef)).toBe(factsBefore);
  }, 300_000);

  it("重评历史按同一风险输入升序给出完整链条，原因与变化引用取 C30 已登记入口事实", async () => {
    // 该风险输入只承载本用例的两条记录：历史读要求页内每条记录都有已登记的运行事实，
    // 混入其它用例的记录会让解释按缺失登记失败闭合。
    const historyRiskInput = {
      kind: "standardized-risk-record" as const,
      reference: { entityId: "risk-record-c25-history", versionId: "1" },
    };
    const first = await evaluateThrough({ suffix: "history-a", riskInput: historyRiskInput });
    await fixture.registerAssessmentRun({
      suffix: "history-a",
      runId: "c25-read-run:history-a",
      recordRef: first.assessmentRecordRef,
      entryMode: "assess",
    });
    // 第二次评估把其中一个监测序列替换为后续修订：替换侧构成可观察的真实输入变化，
    // 且每个序列仍恰好一个快照，指标覆盖保持完整。
    // 修订号取本用例独占的身份：复用早前用例的修订会命中撤权前签发的授权上下文。
    const replaced = await fixture.seriesVariant({
      seriesId: "c25-series-settlement",
      seriesVersion: "3",
      canonicalUnit: "mm",
      values: [5.5, 6, 6.5, 7, 7.5],
    });
    const second = await evaluateThrough({
      suffix: "history-b",
      riskInput: historyRiskInput,
      reassessment: {
        previousAssessmentRecordRef: first.assessmentRecordRef,
        monitoringSnapshotRefs: [replaced, ...fixture.monitoringSnapshotRefs.slice(1)],
      },
    });
    // 变化引用必须逐项对应真实的输入变化：新旧两个版本的快照加上前驱记录本身。
    const changedInputRefs = [first.assessmentRecordRef, replaced];
    await fixture.registerAssessmentRun({
      suffix: "history-b",
      runId: "c25-read-run:history-b",
      recordRef: second.assessmentRecordRef,
      entryMode: "reassess",
      reassessmentEntry: {
        previousAssessmentRecordRef: first.assessmentRecordRef,
        reason: "monitoring-snapshot",
        changedInputRefs,
      },
    });
    const factsBefore = {
      first: await storedFactsText(first.assessmentRecordRef),
      second: await storedFactsText(second.assessmentRecordRef),
    };

    const history = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-reassessment-history",
        payload: {
          operation: "reassessment-history",
          riskInput: historyRiskInput,
        },
      }),
    );
    expect(history).toMatchObject({ kind: "succeeded", result: { kind: "reassessment-history" } });
    if (history.kind !== "succeeded" || history.result.kind !== "reassessment-history")
      throw new Error("expected a reassessment history page");
    const chain = history.result.items.filter((entry) =>
      [
        first.assessmentRecordRef.reference.entityId,
        second.assessmentRecordRef.reference.entityId,
      ].includes(entry.assessmentRecordRef.reference.entityId),
    );
    expect(chain).toHaveLength(2);
    // 时点相同的记录以记录标识定序，因此链条顺序由已登记的前驱关系证明，而不是位置。
    const initial = chain.find(
      (entry) =>
        entry.assessmentRecordRef.reference.entityId ===
        first.assessmentRecordRef.reference.entityId,
    )!;
    const reassessed = chain.find(
      (entry) =>
        entry.assessmentRecordRef.reference.entityId ===
        second.assessmentRecordRef.reference.entityId,
    )!;
    expect(initial.entryMode).toBe("assess");
    expect(initial.previousAssessmentRecordRef).toBeUndefined();
    expect(initial.reason).toBeUndefined();
    expect(initial.changedInputRefs).toEqual([]);
    expect(reassessed.entryMode).toBe("reassess");
    expect(reassessed.previousAssessmentRecordRef).toEqual(first.assessmentRecordRef);
    expect(reassessed.reason).toBe("monitoring-snapshot");
    expect(reassessed.changedInputRefs).toEqual(changedInputRefs);
    // 整页按业务时点升序，页面自身不重排。
    const occurredAt = history.result.items.map((entry) => entry.occurredAt);
    expect(occurredAt).toEqual([...occurredAt].sort((left, right) => left.localeCompare(right)));

    // 分页：首页只给一条并给出游标，游标续页给出链条后半段。
    const firstPage = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-reassessment-history-page-1",
        payload: {
          operation: "reassessment-history",
          riskInput: historyRiskInput,
          pageSize: 1,
        },
      }),
    );
    expect(firstPage).toMatchObject({ kind: "succeeded" });
    if (firstPage.kind !== "succeeded" || firstPage.result.kind !== "reassessment-history")
      throw new Error("expected a history first page");
    expect(firstPage.result.items).toHaveLength(1);
    expect(firstPage.result.nextCursor).toBeDefined();
    const secondPage = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-reassessment-history-page-2",
        payload: {
          operation: "reassessment-history",
          riskInput: historyRiskInput,
          pageSize: 1,
          cursor: firstPage.result.nextCursor,
        },
      }),
    );
    expect(secondPage).toMatchObject({ kind: "succeeded" });
    if (secondPage.kind !== "succeeded" || secondPage.result.kind !== "reassessment-history")
      throw new Error("expected a history second page");
    expect(secondPage.result.items).toHaveLength(1);
    expect(secondPage.result.items[0]!.assessmentRecordRef).not.toEqual(
      firstPage.result.items[0]!.assessmentRecordRef,
    );
    expect(
      new Set(
        [...firstPage.result.items, ...secondPage.result.items].map(
          (entry) => entry.assessmentRecordRef.reference.entityId,
        ),
      ),
    ).toEqual(new Set(chain.map((entry) => entry.assessmentRecordRef.reference.entityId)));

    // 历史只追加：读历史不产生新记录，也不改写前侧与后侧的任何已登记事实。
    expect(await storedFactsText(first.assessmentRecordRef)).toBe(factsBefore.first);
    expect(await storedFactsText(second.assessmentRecordRef)).toBe(factsBefore.second);
  }, 300_000);

  it("解释缺失时记录读取失败闭合，不返回半份解释；总览按空间范围独立统计", async () => {
    const assessed = await evaluateThrough({ suffix: "explanation" });
    await fixture.registerAssessmentRun({
      suffix: "explanation",
      runId: "c25-read-run:explanation",
      recordRef: assessed.assessmentRecordRef,
      entryMode: "assess",
    });
    const valueSetRow = await fixture.postgres.postgres.adminPool.query<{
      value_set_id: string;
      version_id: string;
      value_set_payload: { values: readonly unknown[] };
    }>(
      "SELECT value_set_id, version_id, value_set_payload FROM business.indicator_actual_value_sets WHERE project_id = $1 AND value_set_id = $2",
      [fixture.projectId, assessed.indicatorActualValueSetRef.reference.entityId],
    );
    expect(valueSetRow.rows).toHaveLength(1);
    const originalPayload = valueSetRow.rows[0]!.value_set_payload;
    const factsBefore = await storedFactsText(assessed.assessmentRecordRef);

    // 篡改保存的实际值集：少一个指标后值集仍可解析，但解释缺项，必须失败闭合。
    const truncated = { ...originalPayload, values: originalPayload.values.slice(1) };
    expect(truncated.values.length).toBeGreaterThan(0);
    await fixture.postgres.postgres.adminPool.query(
      "UPDATE business.indicator_actual_value_sets SET value_set_payload = $3::jsonb WHERE project_id = $1 AND value_set_id = $2",
      [fixture.projectId, valueSetRow.rows[0]!.value_set_id, JSON.stringify(truncated)],
    );
    try {
      expectClosedBusinessBlocked(
        await fixture.engine.read(
          await entryReadQuery({
            queryId: "c25-record-read-missing-explanation",
            payload: {
              operation: "record-read",
              assessmentRecordRef: assessed.assessmentRecordRef,
            },
          }),
        ),
        "indicator-actual-value-missing",
      );
    } finally {
      await fixture.postgres.postgres.adminPool.query(
        "UPDATE business.indicator_actual_value_sets SET value_set_payload = $3::jsonb WHERE project_id = $1 AND value_set_id = $2",
        [fixture.projectId, valueSetRow.rows[0]!.value_set_id, JSON.stringify(originalPayload)],
      );
    }

    // 精确记录不存在时同样失败闭合，且不枚举存在性。
    expect(
      await fixture.engine.read(
        await entryReadQuery({
          queryId: "c25-record-read-absent",
          payload: {
            operation: "record-read",
            assessmentRecordRef: {
              kind: "risk-assessment-record",
              reference: { entityId: "assessment-record-not-registered", versionId: "1" },
            },
          },
        }),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await storedFactsText(assessed.assessmentRecordRef)).toBe(factsBefore);

    // 总览只统计已入库的评估记录版本，并按请求空间范围收窄统计窗口。
    const storedRecords = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    const overview = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-overview",
        payload: { operation: "overview", projectRevisionRef: fixture.projectRevisionRef },
      }),
    );
    expect(overview).toMatchObject({ kind: "succeeded", result: { kind: "overview" } });
    if (overview.kind !== "succeeded" || overview.result.kind !== "overview")
      throw new Error("expected an overview");
    expect(overview.result.projectId).toBe(fixture.projectId);
    expect(overview.result.recordedAssessmentCount).toBe(storedRecords);
    expect(overview.result.riskLevelCounts.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      storedRecords,
    );
    expect(overview.result.riskLevelCounts.map((entry) => entry.riskLevel)).toEqual(
      [...overview.result.riskLevelCounts.map((entry) => entry.riskLevel)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(overview.result.actions).toContainEqual({
      branch: "risk-assessment.initial",
      availability: "allowed",
    });

    const scoped = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-overview-scoped",
        payload: {
          operation: "overview",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: fixture.businessSpatialScopeRef,
        },
      }),
    );
    expect(scoped).toMatchObject({ kind: "succeeded" });
    if (scoped.kind !== "succeeded" || scoped.result.kind !== "overview")
      throw new Error("expected a scoped overview");
    expect(scoped.result.spatialScopeRef).toEqual(fixture.businessSpatialScopeRef);
    expect(scoped.result.recordedAssessmentCount).toBe(storedRecords);

    const foreignScope = await fixture.engine.read(
      await entryReadQuery({
        queryId: "c25-overview-foreign-scope",
        payload: {
          operation: "overview",
          projectRevisionRef: fixture.projectRevisionRef,
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: "scope-outside-c25", versionId: "1" },
          },
        },
      }),
    );
    expect(foreignScope).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
  }, 300_000);

  /**
   * 预测风险状态投影（design D-08）：按基线记录冻结的同一评分依据重算，风险状态随目标
   * 指标预测值变化；它不是一次正式评估，因此不产生任何实际事实写入。
   */
  describe("预测风险状态投影", () => {
    /** 先跑一次正式评估，拿到真实的基线记录与冻结输入快照。 */
    const evaluatedBaseline = async (suffix: string) => {
      const preparation = await freshPreparation(`forecast-${suffix}`);
      const prepared = await fixture.engine.prepare(
        (await fixture.prepareCommand({
          commandId: `forecast-prepare-${suffix}`,
          preparation,
        })) as never,
      );
      expect(prepared.kind).toBe("succeeded");
      if (prepared.kind !== "succeeded") throw new Error("baseline preparation failed");
      const inputSnapshotRef = prepared.result.assessmentInputSnapshotRef;
      const evaluated = await fixture.engine.evaluate(
        (await fixture.evaluateCommand({
          commandId: `forecast-eval-${suffix}`,
          inputSnapshotRef,
        })) as never,
      );
      expect(evaluated.kind).toBe("succeeded");
      if (evaluated.kind !== "succeeded") throw new Error("baseline evaluation failed");
      return {
        inputSnapshotRef,
        baselineAssessmentRecordRef: evaluated.result.assessmentRecordRef,
      };
    };

    /** 预测请求：授权沿用正式评估的输入快照读取分支——同一身份、同一能力面。 */
    const forecastRequest = async (input: {
      readonly requestId: string;
      readonly baselineAssessmentRecordRef: unknown;
      readonly inputSnapshotRef: unknown;
      readonly targetIndicatorId: string;
      readonly targetUnit: string;
      readonly predictedValue: number;
      /** 执行前监测快照默认取夹具登记的地表沉降序列，它承载后果指标。 */
      readonly preActionMonitoringSnapshotRef?: {
        readonly kind: "monitoring-snapshot";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
    }) => ({
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      projectId: fixture.projectId,
      actorId: fixture.managerId,
      // C06 把上下文与签发时的调用标识绑定，因此签发与复验必须用同一个 requestId。
      authorization: await fixture.readAuthorization(input.requestId),
      baselineAssessmentRecordRef: input.baselineAssessmentRecordRef,
      frozenAssessmentBasisRef: input.inputSnapshotRef,
      preActionMonitoringSnapshotRef:
        input.preActionMonitoringSnapshotRef ?? fixture.monitoringSnapshotRefs[0]!,
      targetIndicatorId: input.targetIndicatorId,
      targetUnit: input.targetUnit,
      predictedValue: input.predictedValue,
    });

    it("目标指标预测值改变时风险状态随之变化且可精确重放", async () => {
      const baseline = await evaluatedBaseline("baseline");
      const countsBefore = {
        records: await countRows(fixture, "business.risk_assessment_records", fixture.projectId),
        valueSets: await countRows(
          fixture,
          "business.indicator_actual_value_sets",
          fixture.projectId,
        ),
        preparations: await countRows(
          fixture,
          "business.assessment_preparation_snapshots",
          fixture.projectId,
        ),
        warnings: await countRows(fixture, "business.warning_records", fixture.projectId),
        events: await countEvents(fixture, "risk-assessment.*"),
      };

      // 后果指标跨评分带：<10mm 得 1 分，>=40mm 得 5 分（该指标的正式量化标准）。
      // 后果轴按最大值取值，因此这一个指标决定整轴分数并推动矩阵换带。
      const low = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-low",
          baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 5,
        })) as never,
      );
      const high = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-high",
          baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 40,
        })) as never,
      );
      expect(low.kind, JSON.stringify(low)).toBe("succeeded");
      expect(high.kind, JSON.stringify(high)).toBe("succeeded");
      if (low.kind !== "succeeded" || high.kind !== "succeeded") return;
      // 可能性轴沿基线实际值不变；只有被预测的那一轴随预测值变化，说明替换只发生一次。
      expect(high.riskState.likelihoodScore).toBe(low.riskState.likelihoodScore);
      expect(high.riskState.consequenceScore).toBeGreaterThan(low.riskState.consequenceScore);
      expect(high.riskState).not.toEqual(low.riskState);

      // 可能性轴：来源字段指标没有监测来源，执行前快照在此只作为请求声明的冻结事实读取。
      // 可能性按 40%/60% 加权，把高权重指标从最低档带到最高档必然改变可能性得分与风险等级。
      const possibilityLow = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-possibility-low",
          baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-possibility-2",
          targetUnit: "1",
          predictedValue: 1,
        })) as never,
      );
      const possibilityHigh = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-possibility-high",
          baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-possibility-2",
          targetUnit: "1",
          predictedValue: 5,
        })) as never,
      );
      if (possibilityLow.kind !== "succeeded" || possibilityHigh.kind !== "succeeded") {
        throw new Error(
          `possibility forecast unavailable: ${JSON.stringify([possibilityLow, possibilityHigh])}`,
        );
      }
      expect(possibilityHigh.riskState.likelihoodScore).toBeGreaterThan(
        possibilityLow.riskState.likelihoodScore,
      );
      // 可能性轴跨带后矩阵换格：风险等级必须随之改变，而不是恒定或缺省。
      expect(possibilityHigh.riskState.riskLevel).not.toBe(possibilityLow.riskState.riskLevel);

      // 同一请求重放给出完全相同的状态：精确重放不依赖执行时刻。
      const replay = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-low",
          baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 5,
        })) as never,
      );
      expect(replay).toEqual(low);

      // 纯计算：不新增任何实际事实，也不发布领域事件。
      expect(await countRows(fixture, "business.risk_assessment_records", fixture.projectId)).toBe(
        countsBefore.records,
      );
      expect(
        await countRows(fixture, "business.indicator_actual_value_sets", fixture.projectId),
      ).toBe(countsBefore.valueSets);
      expect(
        await countRows(fixture, "business.assessment_preparation_snapshots", fixture.projectId),
      ).toBe(countsBefore.preparations);
      expect(await countRows(fixture, "business.warning_records", fixture.projectId)).toBe(
        countsBefore.warnings,
      );
      expect(await countEvents(fixture, "risk-assessment.*")).toBe(countsBefore.events);
    }, 300_000);

    it("冻结依据、指标、单位或监测序列不相容时按受控结果收敛且不返回分数", async () => {
      const baseline = await evaluatedBaseline("mismatch");
      const settlementSnapshot = fixture.monitoringSnapshotRefs[0]!;
      const waterLevelSnapshot = fixture.monitoringSnapshotRefs[1]!;
      const cases = [
        {
          label: "frozen-basis-mismatch",
          expected: { kind: "unavailable", reasonCode: "risk-state-unavailable" },
          inputSnapshotRef: {
            kind: "assessment-input-snapshot" as const,
            reference: { entityId: "forecast-absent-input", versionId: "1" },
          },
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 8,
          preActionMonitoringSnapshotRef: settlementSnapshot,
        },
        {
          label: "indicator-missing",
          expected: { kind: "unavailable", reasonCode: "risk-state-unavailable" },
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-not-in-basis",
          targetUnit: "mm",
          predictedValue: 8,
          preActionMonitoringSnapshotRef: settlementSnapshot,
        },
        {
          label: "unit-mismatch",
          expected: { kind: "unavailable", reasonCode: "risk-state-unavailable" },
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "m",
          predictedValue: 8,
          preActionMonitoringSnapshotRef: settlementSnapshot,
        },
        {
          // 指标与单位都相容，但执行前快照是地下水位序列：它不承载目标指标，不做跨序列推断。
          label: "monitoring-series-mismatch",
          expected: { kind: "unavailable", reasonCode: "monitoring-series-mismatch" },
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 8,
          preActionMonitoringSnapshotRef: waterLevelSnapshot,
        },
        {
          // 请求声明的快照版本不存在：按精确引用读不到即类型化失败，不退化成"序列不匹配"，
          // 也不沿用基线风险状态冒充预测。
          label: "monitoring-snapshot-unreadable",
          expected: { kind: "failed" },
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 8,
          preActionMonitoringSnapshotRef: {
            kind: "monitoring-snapshot" as const,
            reference: { entityId: settlementSnapshot.reference.entityId, versionId: "9" },
          },
        },
      ];
      for (const current of cases) {
        const result = await fixture.engine.projectForecastRiskState(
          (await forecastRequest({
            requestId: `forecast-risk-${current.label}`,
            baselineAssessmentRecordRef: baseline.baselineAssessmentRecordRef,
            inputSnapshotRef: current.inputSnapshotRef,
            targetIndicatorId: current.targetIndicatorId,
            targetUnit: current.targetUnit,
            predictedValue: current.predictedValue,
            preActionMonitoringSnapshotRef: current.preActionMonitoringSnapshotRef,
          })) as never,
        );
        expect(result, current.label).toMatchObject(current.expected);
        expect(result, current.label).not.toHaveProperty("riskState");
      }
    }, 300_000);

    it("基线记录不存在或授权身份不符时关闭失败", async () => {
      const baseline = await evaluatedBaseline("denied");
      const absent = await fixture.engine.projectForecastRiskState(
        (await forecastRequest({
          requestId: "forecast-risk-absent-record",
          baselineAssessmentRecordRef: {
            kind: "risk-assessment-record",
            reference: { entityId: "forecast-absent-record", versionId: "1" },
          },
          inputSnapshotRef: baseline.inputSnapshotRef,
          targetIndicatorId: "indicator-consequence-1",
          targetUnit: "mm",
          predictedValue: 8,
        })) as never,
      );
      expect(absent).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    }, 300_000);
  });

  // ---------------------------------------------------------------- CH-3 仪表盘评估来源

  const DASHBOARD_AS_OF = "2099-12-31T23:59:59.999999Z";

  /** 仪表盘来源请求：身份即 queryId，授权沿 `risk-assessment.read` 真实签发。 */
  const dashboardRequest = async (input: {
    readonly queryId: string;
    readonly projectId?: string;
    readonly spatialScopeRef?: SpatialScopeRefV1;
    readonly asOf?: string;
    readonly pageSize?: number;
    readonly after?: RiskDashboardTimelineAfterV1;
  }): Promise<RiskDashboardAssessmentsSourceRequestV1> => ({
    queryId: input.queryId,
    projectId: input.projectId ?? fixture.projectId,
    actorId: fixture.managerId,
    requestedAt: ENTRY_READ_AT,
    authorization: await fixture.entryReadAuthorization(input.queryId, {
      spatialScopeRefs: [fixture.accessRootScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    }),
    ...(input.spatialScopeRef === undefined ? {} : { spatialScopeRef: input.spatialScopeRef }),
    timeline: {
      asOf: input.asOf ?? DASHBOARD_AS_OF,
      pageSize: input.pageSize ?? 50,
      ...(input.after === undefined ? {} : { after: input.after }),
    },
  });

  const expectDashboardDenied = (result: RiskDashboardAssessmentsSourceResultV1) => {
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("expected a closed dashboard failure");
    expect(result.error).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
    });
  };

  it("仪表盘评估来源按冻结矩阵×等级分组，缺矩阵不参与且变化页有界有序", async () => {
    const pool = fixture.postgres.postgres.adminPool;
    const records = [
      await evaluateThrough({ suffix: "dashboard-matrix-a" }),
      await evaluateThrough({ suffix: "dashboard-matrix-b" }),
      await evaluateThrough({ suffix: "dashboard-matrix-c" }),
    ];
    const setMatrix = async (
      input: AssessmentInputSnapshotRefV1,
      matrix: { readonly entityId: string; readonly versionId: string } | undefined,
    ) => {
      if (matrix === undefined) {
        await pool.query(
          `UPDATE business.assessment_input_snapshots
              SET snapshot_payload = snapshot_payload #- '{riskMatrixRef}'
            WHERE project_id = $1 AND input_snapshot_id = $2 AND version_id = $3`,
          [fixture.projectId, input.reference.entityId, input.reference.versionId],
        );
        return;
      }
      await pool.query(
        `UPDATE business.assessment_input_snapshots
            SET snapshot_payload = jsonb_set(snapshot_payload, '{riskMatrixRef}', $4::jsonb)
          WHERE project_id = $1 AND input_snapshot_id = $2 AND version_id = $3`,
        [
          fixture.projectId,
          input.reference.entityId,
          input.reference.versionId,
          JSON.stringify(matrix),
        ],
      );
    };
    await setMatrix(records[0]!.inputSnapshotRef, {
      entityId: "dashboard-matrix-one",
      versionId: "1",
    });
    await setMatrix(records[1]!.inputSnapshotRef, {
      entityId: "dashboard-matrix-two",
      versionId: "1",
    });
    // 缺冻结矩阵引用的记录保留在版本计数里，但不伪造任何矩阵分组。
    await setMatrix(records[2]!.inputSnapshotRef, undefined);
    await pool.query(
      `UPDATE business.risk_assessment_records
          SET risk_level_id = 'dashboard-shared-level'
        WHERE project_id = $1 AND record_id = ANY($2)`,
      [
        fixture.projectId,
        records.slice(0, 2).map((record) => record.assessmentRecordRef.reference.entityId),
      ],
    );

    const result = await fixture.engine.readDashboard(
      await dashboardRequest({ queryId: "c25-dashboard-matrix", pageSize: 1 }),
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(RiskDashboardAssessmentsSourceResultV1Schema.parse(result)).toEqual(result);
    const storedRecords = await countRows(
      fixture,
      "business.risk_assessment_records",
      fixture.projectId,
    );
    expect(result.data.recordedAssessmentCount).toBe(storedRecords);
    // 同一等级在两个冻结矩阵下各成一组：矩阵精确版本参与分组键，不按等级名合并。
    expect(
      result.data.matrixLevelCounts.filter((entry) =>
        entry.riskMatrixRef.entityId.startsWith("dashboard-matrix-"),
      ),
    ).toEqual([
      {
        riskMatrixRef: { entityId: "dashboard-matrix-one", versionId: "1" },
        riskLevelId: "dashboard-shared-level",
        count: 1,
      },
      {
        riskMatrixRef: { entityId: "dashboard-matrix-two", versionId: "1" },
        riskLevelId: "dashboard-shared-level",
        count: 1,
      },
    ]);
    expect(result.data.matrixLevelCounts.reduce((total, entry) => total + entry.count, 0)).toBe(
      storedRecords - 1,
    );
    // 来源只取 pageSize+1 条候选，多出的一条用于全局合并判定。
    expect(result.events).toHaveLength(2);
    expect(result.events.every((event) => event.source === "assessments")).toBe(true);
    expect(result.events.every((event) => event.changeType === "assessment-recorded")).toBe(true);
    expect(result.events.every((event) => event.subjectRef.kind === "risk-assessment-record")).toBe(
      true,
    );
    expect(result.events[0]!.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

    // 续页沿用同一个上界：逐页收集与库中的完整全序逐项相等，不重不漏。
    const collected: RiskDashboardTimelineEventV1[] = [];
    let after: RiskDashboardTimelineAfterV1 | undefined;
    for (let page = 0; page < 100; page += 1) {
      const current = await fixture.engine.readDashboard(
        await dashboardRequest({
          queryId: `c25-dashboard-page-${page}`,
          pageSize: 2,
          ...(after === undefined ? {} : { after }),
        }),
      );
      if (current.kind !== "ready") throw new Error("expected a ready dashboard page");
      collected.push(...current.events.slice(0, 2));
      if (current.events.length <= 2) break;
      const cursor = current.events[1]!;
      after = {
        recordedAt: cursor.recordedAt,
        source: "assessments",
        entityId: cursor.subjectRef.reference.entityId,
        versionId: cursor.subjectRef.reference.versionId,
      };
    }
    const ordered = await pool.query<{
      entity_id: string;
      version_id: string;
      recorded_at: string;
    }>(
      `SELECT record_id AS entity_id,
              version_id,
              to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
         FROM business.risk_assessment_records
        WHERE project_id = $1
        ORDER BY recorded_at DESC, record_id ASC, version_id ASC`,
      [fixture.projectId],
    );
    expect(
      collected.map((event) => ({
        entityId: event.subjectRef.reference.entityId,
        versionId: event.subjectRef.reference.versionId,
        recordedAt: event.recordedAt,
      })),
    ).toEqual(
      ordered.rows.map((row) => ({
        entityId: row.entity_id,
        versionId: row.version_id,
        recordedAt: row.recorded_at,
      })),
    );

    // 上界只收窄变化页，不改变当前统计快照。
    const bounded = await fixture.engine.readDashboard(
      await dashboardRequest({
        queryId: "c25-dashboard-asof",
        asOf: "2000-01-01T00:00:00.000000Z",
      }),
    );
    expect(bounded.kind).toBe("ready");
    if (bounded.kind !== "ready") return;
    expect(bounded.events).toEqual([]);
    expect(bounded.data.recordedAssessmentCount).toBe(storedRecords);
  }, 300_000);

  it("仪表盘评估来源在能力缺失、资料撤权与越界空间上整体失败", async () => {
    const verify = fixture.postgres.access.verify.bind(fixture.postgres.access);
    const capability = vi
      .spyOn(fixture.postgres.access, "verify")
      .mockImplementation(async (request) => {
        const decision = await verify(request);
        return { ...decision, context: { ...decision.context, grantedCapabilities: [] } };
      });
    try {
      expectDashboardDenied(
        await fixture.engine.readDashboard(
          await dashboardRequest({ queryId: "c25-dashboard-no-capability" }),
        ),
      );
    } finally {
      capability.mockRestore();
    }

    // 当前授权复验拒绝（撤权后）→ 同形授权失败，不折叠成零数据。
    const filter = fixture.postgres.access.filterVisibleSources!;
    fixture.postgres.access.filterVisibleSources = async () => {
      throw new AccessServiceError({
        code: "AUTHORIZATION_DENIED",
        stage: "authorize.visible-sources",
        occurredAt: ENTRY_READ_AT,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "c25-dashboard-denied", versionId: "1" },
        },
        contextRefs: [],
        retryable: false,
        requiredCapability: "risk-assessment.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    };
    try {
      expectDashboardDenied(
        await fixture.engine.readDashboard(
          await dashboardRequest({ queryId: "c25-dashboard-no-source" }),
        ),
      );
    } finally {
      fixture.postgres.access.filterVisibleSources = filter;
    }

    expectDashboardDenied(
      await fixture.engine.readDashboard(
        await dashboardRequest({
          queryId: "c25-dashboard-foreign-scope",
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: "dashboard-scope-not-granted", versionId: "1" },
          },
        }),
      ),
    );
    expectDashboardDenied(
      await fixture.engine.readDashboard(
        await dashboardRequest({
          queryId: "c25-dashboard-foreign-project",
          projectId: "dashboard-foreign-project",
        }),
      ),
    );
  }, 300_000);

  it("仪表盘评估来源分组超界整来源失败而非截断", async () => {
    const pool = fixture.postgres.postgres.adminPool;
    const seed = await evaluateThrough({ suffix: "dashboard-overflow-seed" });
    const overflowInputs = await cloneSeedSql({
      table: "assessment_input_snapshots",
      alias: "i",
      where: "WHERE i.input_snapshot_id = $1 AND i.version_id = $2",
      overrides: {
        input_snapshot_id: "'dashboard-overflow-input-' || n::text",
        reference_digest: "lpad(to_hex(n + 3000000), 64, '0')",
        snapshot_payload: `jsonb_set(i.snapshot_payload, '{riskMatrixRef}',
          jsonb_build_object('entityId', 'dashboard-overflow-matrix-' || n::text,
                             'versionId', '1'))`,
      },
    });
    const overflowRecords = await cloneSeedSql({
      table: "risk_assessment_records",
      alias: "r",
      where: "WHERE r.record_id = $1 AND r.version_id = $2",
      overrides: {
        record_id: "'dashboard-overflow-record-' || n::text",
        input_snapshot_id: "'dashboard-overflow-input-' || n::text",
        identity_digest: "lpad(to_hex(n + 3000000), 64, '0')",
      },
    });
    try {
      await pool.query(overflowInputs, [
        seed.inputSnapshotRef.reference.entityId,
        seed.inputSnapshotRef.reference.versionId,
      ]);
      await pool.query(overflowRecords, [
        seed.assessmentRecordRef.reference.entityId,
        seed.assessmentRecordRef.reference.versionId,
      ]);
      const result = await fixture.engine.readDashboard(
        await dashboardRequest({ queryId: "c25-dashboard-overflow" }),
      );
      expect(result).toMatchObject({
        kind: "failed",
        error: {
          code: "BUSINESS_BLOCKED",
          blockerKind: "dashboard-group-limit",
          retryable: false,
        },
      });
      expect(RiskDashboardAssessmentsSourceResultV1Schema.parse(result)).toEqual(result);
    } finally {
      await pool.query(
        "DELETE FROM business.risk_assessment_records WHERE project_id = $1 AND record_id LIKE 'dashboard-overflow-record-%'",
        [fixture.projectId],
      );
      await pool.query(
        "DELETE FROM business.assessment_input_snapshots WHERE project_id = $1 AND input_snapshot_id LIKE 'dashboard-overflow-input-%'",
        [fixture.projectId],
      );
    }
  }, 300_000);
});
