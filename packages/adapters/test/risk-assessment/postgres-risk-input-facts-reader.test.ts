import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRiskInputFactsReader,
  RiskInputFactsReadRequestV1Schema,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import { ExternalRiskEventFactsArtifactV1Schema } from "@riskflow/core/engineering-data/context-source";
import type {
  ExternalRiskEventRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
  StandardizedRiskRecordRefV1,
} from "@riskflow/contracts/ports";
import { createPostgresExternalRiskInputFactsReader } from "../../src/engineering-data/context-source/postgres-external-risk-input-facts-reader.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../src/identification/read/postgres-standardized-risk-input-facts-reader.js";

import {
  startProductionAssessmentSeamsFixture,
  type ProductionAssessmentSeamsFixtureV1,
} from "./production-assessment-seams.fixture.js";

const T0 = "2030-01-01T00:00:00.000Z";

/**
 * IP-02/IP-03/IP-04 的稳定行为证据：XOR 只有两个分支、身份与授权必须仍是调用方那一份、
 * 缺登记/错版本/证据不匹配/超预算一律关闭失败，以及两个 owning reader 与 C11 准备冻结、
 * C25 正式评估在单库上消费同一个组合 reader。
 */
describe("统一风险事实生产读取接缝", () => {
  let fixture: ProductionAssessmentSeamsFixtureV1;
  let recordRef: StandardizedRiskRecordRefV1;
  let eventRef: ExternalRiskEventRefV1;
  let secondSegmentId: string;

  const readRequest = async (input: {
    readonly requestId: string;
    readonly riskInput: unknown;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }) => {
    const authorization = await fixture.authorizeEvidenceAccess(input.requestId, {
      spatialScopeRefs: input.spatialScopeRefs,
      sourceVersionRefs: input.sourceVersionRefs,
    });
    return RiskInputFactsReadRequestV1Schema.parse({
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestedAt: T0,
      authorization,
      riskInput: input.riskInput,
    });
  };

  beforeAll(async () => {
    fixture = await startProductionAssessmentSeamsFixture();
    recordRef = await fixture.registerAcceptedStandardizedRiskRecord({ suffix: "seam" });
    secondSegmentId = `${fixture.sourceVersionRef.reference.entityId}-chapter_1-segment_1`;
    eventRef = await fixture.registerExternalRiskEventWithBody({
      suffix: "seam",
      body: ExternalRiskEventFactsArtifactV1Schema.parse({
        schemaVersion: "1",
        projectId: fixture.projectId,
        externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
        externalEventKey: "external-event-seam",
        fields: [
          {
            documentType: "external-risk-event",
            fieldPath: ["geology", "overburdenThickness"],
            value: 12.5,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: secondSegmentId },
                sourceVersion: fixture.sourceVersionRef.reference,
              },
            ],
          },
        ],
      }),
    });
  }, 300_000);

  afterAll(async () => {
    await fixture?.postgres.close();
  }, 60_000);

  const recordRequest = (requestId: string) =>
    readRequest({
      requestId,
      riskInput: recordRef,
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });

  const eventRequest = (requestId: string) =>
    readRequest({
      requestId,
      riskInput: eventRef,
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });

  it("标准化风险记录分支只投影记录自身六个正式标量", async () => {
    const result = await fixture.riskInputFacts.readRiskInputFacts(
      await recordRequest("seam-record-ok"),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.facts.projectId).toBe(fixture.projectId);
    expect(result.facts.riskInput).toEqual(recordRef);
    expect(result.facts.fields.map((field) => field.fieldPath.join(".")).sort()).toEqual([
      "compositeConfidence.value",
      "record.modelConfidence",
      "record.processNodeId",
      "record.riskEvent",
      "record.riskFactor",
      "record.riskSource",
    ]);
    for (const field of result.facts.fields) {
      expect(field.documentType).toBe("standardized-risk-record");
      expect(field.evidenceReferences.length).toBeGreaterThan(0);
    }
  });

  it("部署空间读取只返回精确登记的范围与识别运行引用", async () => {
    const reader = createPostgresStandardizedRiskInputFactsReader({
      db: fixture.postgres.runtime.db,
      authorization: fixture.postgres.access,
    });
    const request = await recordRequest("seam-deployment-scopes");
    const result = await reader.readDeploymentRiskScopes(request);
    const registered = await fixture.postgres.postgres.adminPool.query<{
      identification_run_ref: unknown;
    }>(
      "SELECT identification_run_ref FROM business.standardized_risk_records WHERE project_id = $1 AND risk_record_id = $2",
      [fixture.projectId, recordRef.reference.entityId],
    );
    expect(result).toEqual({
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
      identificationRunRef: registered.rows[0]?.identification_run_ref,
    });

    const wrongVersion = await readRequest({
      requestId: "seam-deployment-scopes-wrong-version",
      riskInput: { ...recordRef, reference: { ...recordRef.reference, versionId: "7" } },
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });
    const denied = await reader.readDeploymentRiskScopes({
      ...request,
      authorization: { ...request.authorization, actorId: "seam-other-actor" },
    });
    expect(await reader.readDeploymentRiskScopes(wrongVersion)).toBeUndefined();
    expect(denied).toBeUndefined();

    const missingRunRegistration = await insertIncompleteRecord("no-identification-run", {
      identification_run_ref: JSON.stringify({ kind: "unregistered-run" }),
    });
    expect(
      await reader.readDeploymentRiskScopes(
        await readRequest({
          requestId: "seam-deployment-scopes-no-run",
          riskInput: missingRunRegistration,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      ),
    ).toBeUndefined();

    const wrongStoredRef = await insertIncompleteRecord("wrong-stored-ref", {
      risk_record_ref: JSON.stringify({
        kind: "standardized-risk-record",
        reference: { entityId: "different-risk-record", versionId: "1" },
      }),
    });
    expect(
      await reader.readDeploymentRiskScopes(
        await readRequest({
          requestId: "seam-deployment-scopes-wrong-ref",
          riskInput: wrongStoredRef,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      ),
    ).toBeUndefined();
  }, 240_000);

  it("外部风险事件分支投影登记时已定型的结构化字段", async () => {
    const result = await fixture.riskInputFacts.readRiskInputFacts(
      await eventRequest("seam-event-ok"),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.facts.fields).toHaveLength(1);
    expect(result.facts.fields[0]?.fieldPath).toEqual(["geology", "overburdenThickness"]);
    expect(result.facts.fields[0]?.value).toBe(12.5);
  });

  it("登记成功不等于可评估：任意已登记 JSON 正文按契约失败闭合", async () => {
    const opaque = await fixture.registerExternalRiskEventWithBody({
      suffix: "opaque",
      body: { note: "自由正文，不承诺任何字段契约" },
    });
    const request = await readRequest({
      requestId: "seam-event-opaque",
      riskInput: opaque,
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });
    const result = await fixture.riskInputFacts.readRiskInputFacts(request);
    expect(result).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
  });

  it("XOR 只有两个分支：自由输入或缺分支一律关闭失败", async () => {
    for (const riskInput of [
      { kind: "arbitrary-document", reference: { entityId: "x", versionId: "1" } },
      { kind: "external-risk-event" },
      { kind: "external-risk-event", reference: { entityId: eventRef.reference.entityId } },
    ]) {
      const authorization = await fixture.authorizeEvidenceAccess("seam-bad-xor", {
        spatialScopeRefs: [fixture.businessSpatialScopeRef],
        sourceVersionRefs: [fixture.sourceVersionRef],
      });
      const result = await fixture.riskInputFacts.readRiskInputFacts({
        requestId: "seam-bad-xor",
        idempotencyKey: "seam-bad-xor",
        requestedAt: T0,
        authorization,
        riskInput,
      } as never);
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "UNSUPPORTED_CONTRACT" },
      });
    }
  });

  it("读取身份不合法时关闭失败", async () => {
    const base = await recordRequest("seam-identity");
    for (const authorization of [
      { ...base.authorization, actorId: "seam-other-actor" },
      { ...base.authorization, grantedCapabilities: ["knowledge-modeling.govern"] },
    ]) {
      const result = await fixture.riskInputFacts.readRiskInputFacts({
        ...base,
        authorization,
      } as never);
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    }
  });

  it("授权失效、错版本与错引用关闭失败且不泄露存在性", async () => {
    const missing = await readRequest({
      requestId: "seam-missing",
      riskInput: {
        kind: "standardized-risk-record",
        reference: { entityId: "c25-record-absent", versionId: "1" },
      },
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });
    const wrongVersion = await readRequest({
      requestId: "seam-wrong-version",
      riskInput: { ...recordRef, reference: { ...recordRef.reference, versionId: "7" } },
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });
    for (const request of [missing, wrongVersion]) {
      const result = await fixture.riskInputFacts.readRiskInputFacts(request);
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    }
  });

  it("会话吊销后同一读取关闭失败，恢复会话后重新成立", async () => {
    const before = await fixture.riskInputFacts.readRiskInputFacts(
      await recordRequest("seam-revoked"),
    );
    expect(before.kind).toBe("succeeded");
    // 授权上下文在吊销前签发：吊销后无法再签新上下文，正好对应「读取已完成、授权随后失效」。
    const pending = await recordRequest("seam-revoked-after");
    await fixture.revokeAfterFirstRead();
    const denied = await fixture.riskInputFacts.readRiskInputFacts(pending);
    expect(denied).toMatchObject({ kind: "failed" });
    await fixture.restoreSession();
    fixture.restoreProductionFactsReader();
    const restored = await fixture.riskInputFacts.readRiskInputFacts(
      await recordRequest("seam-revoked-restored"),
    );
    expect(restored.kind).toBe("succeeded");
  });

  it("标准记录分支经同一组合 reader 走完准备冻结、输入冻结、正式评估与持久回读", async () => {
    const preparation = await fixture.freezePreparation({
      suffix: "seam-production",
      entryMode: "assess",
      triggerReasonCode: "manual-assessment",
      riskInput: recordRef,
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
    });
    expect(preparation.kind).toBe("assessment-preparation-snapshot");
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "seam-prepare-production",
        preparation,
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const evaluation = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "seam-evaluate-production",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluation.kind).toBe("succeeded");
    if (evaluation.kind !== "succeeded") return;

    // 正式记录与真实回执必须落库可回读，不能只出现在返回值里。
    const records = await fixture.postgres.postgres.adminPool.query<{
      record_id: string;
      risk_input_kind: string;
      risk_record_id: string | null;
    }>(
      "SELECT record_id, risk_input_kind, risk_record_id FROM business.risk_assessment_records WHERE project_id = $1",
      [fixture.projectId],
    );
    expect(records.rows.length).toBeGreaterThan(0);
    expect(records.rows[0]).toMatchObject({
      risk_input_kind: "standardized-risk-record",
      risk_record_id: recordRef.reference.entityId,
    });
    const receipts = await fixture.postgres.postgres.adminPool.query<{ command_id: string }>(
      "SELECT command_id FROM business.command_receipts WHERE project_id = $1",
      [fixture.projectId],
    );
    expect(receipts.rows.map((row) => row.command_id)).toContain("seam-evaluate-production");
  }, 240_000);

  /**
   * 直接登记缺少既定事实的精确行：验收决定、空间/来源范围、证据或正文任一不合规都不得读出字段。
   * 这里写库而不是走命令，因为这些形态在正式流程里根本不会被写出来，而 reader 必须能挡住它们。
   */
  const insertIncompleteRecord = async (suffix: string, override: Record<string, unknown>) => {
    const riskRecordId = `c25-record-${suffix}`;
    const envelope = {
      riskRecordId,
      record: {
        processNodeId: "c25-process-node",
        riskSource: "c25-risk-source",
        riskFactor: "c25-risk-factor",
        riskEvent: "c25-risk-event",
        riskElementRelations: [
          { sourceElement: "c25-element", relation: "affects", targetElement: "c25-worksite" },
        ],
        evidenceLocator: { sourceSegmentId: secondSegmentId },
        modelConfidence: 0.8,
      },
      riskMechanismEntryIds: ["c25-mechanism"],
      sourceIds: [fixture.sourceVersionRef.reference.entityId],
      compositeConfidence: { value: 0.7, basis: ["c25-confidence-basis"] },
      version: {
        reference: { entityId: riskRecordId, versionId: "1" },
        effectivePeriod: { validFrom: T0 },
        systemTime: { recordedAt: T0 },
      },
      audit: { actorId: fixture.managerId, action: "identification.accept-groups", recordedAt: T0 },
    };
    const versionRef = { entityId: riskRecordId, versionId: "1" };
    const columns: Record<string, unknown> = {
      project_id: fixture.projectId,
      risk_record_id: riskRecordId,
      version_id: "1",
      risk_record_ref: JSON.stringify({ kind: "standardized-risk-record", reference: versionRef }),
      row_id: `${riskRecordId}-row`,
      idempotency_key: riskRecordId,
      request_digest: "a".repeat(64),
      payload: JSON.stringify(envelope),
      input_snapshot_ref: JSON.stringify({
        kind: "identification-input-snapshot",
        reference: { entityId: `${riskRecordId}-snapshot`, versionId: "1" },
      }),
      identification_run_ref: JSON.stringify({
        kind: "workflow-run",
        reference: { entityId: `${riskRecordId}-run`, versionId: "1" },
      }),
      merge_plan_ref: JSON.stringify({
        kind: "merge-plan",
        reference: { entityId: `${riskRecordId}-merge`, versionId: "1" },
      }),
      route_decision_ref: null,
      review_decision_ref: JSON.stringify({
        kind: "review-decision",
        reference: { entityId: `${riskRecordId}-review`, versionId: "1" },
      }),
      group_id: `${riskRecordId}-group`,
      group_version_id: "1",
      group_ref: JSON.stringify({
        kind: "identification-group",
        reference: { entityId: `${riskRecordId}-group`, versionId: "1" },
      }),
      representative_candidate_refs: JSON.stringify([
        {
          kind: "content-artifact",
          reference: { entityId: `${riskRecordId}-candidate`, versionId: "1" },
        },
      ]),
      source_segment_ids: JSON.stringify([secondSegmentId]),
      mechanism_entry_ids: JSON.stringify(["c25-mechanism"]),
      spatial_scope_refs: JSON.stringify([fixture.businessSpatialScopeRef]),
      source_version_refs: JSON.stringify([fixture.sourceVersionRef]),
      evidence_references: JSON.stringify([
        {
          locator: { sourceSegmentId: secondSegmentId },
          sourceVersion: fixture.sourceVersionRef.reference,
        },
      ]),
      authorization_scope_digest: "b".repeat(64),
      authorization_context_ref: JSON.stringify({
        kind: "authorization-context",
        reference: { entityId: `${riskRecordId}-auth`, versionId: "1" },
      }),
      actor_ref: fixture.managerId,
      command_id: riskRecordId,
      audit_entry_id: `${riskRecordId}:audit`,
      created_at: T0,
      ...override,
    };
    const keys = Object.keys(columns);
    // 审计外键是延迟约束：先补一条可引用的审计行，才能插入这条不合规登记。
    await fixture.postgres.postgres.adminPool.query(
      `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
       VALUES ($1, $2, 'fixture.incomplete-record', '{}', $3, '{}', $4, NOW(), NOW(), $5, $5)
       ON CONFLICT DO NOTHING`,
      [`${riskRecordId}:audit`, fixture.projectId, fixture.managerId, "1", riskRecordId],
    );
    await fixture.postgres.postgres.adminPool.query(
      `INSERT INTO business.standardized_risk_records (${keys.join(", ")})
       VALUES (${keys.map((_, index) => `$${index + 1}`).join(", ")})`,
      keys.map((key) => columns[key] as never),
    );
    return {
      kind: "standardized-risk-record" as const,
      reference: versionRef,
    };
  };

  it("缺验收事实、缺已保存范围、缺证据或错 payload 时按授权失败闭合", async () => {
    const cases = [
      // 无验收决定的行由 `standardized_risk_records_decision_ck` 禁止写入，数据库层就不存在该状态；
      // 这里改用「有决定列但引用不合规」覆盖同一条防御线。
      {
        suffix: "bad-decision-ref",
        override: { review_decision_ref: JSON.stringify({ kind: "not-a-decision" }) },
      },
      { suffix: "no-scope", override: { spatial_scope_refs: null } },
      { suffix: "no-source", override: { source_version_refs: null } },
      { suffix: "no-evidence", override: { evidence_references: null } },
      { suffix: "bad-payload", override: { payload: JSON.stringify({ riskRecordId: "x" }) } },
    ] as const;
    for (const testCase of cases) {
      const riskInput = await insertIncompleteRecord(testCase.suffix, testCase.override);
      const result = await fixture.riskInputFacts.readRiskInputFacts(
        await readRequest({
          requestId: `seam-${testCase.suffix}`,
          riskInput,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      );
      // 失败闭合不得读出任何字段。
      expect(result.kind, testCase.suffix).toBe("failed");
      expect(result, testCase.suffix).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    }
  }, 240_000);

  it("拒绝超出登记来源范围的标准记录证据", async () => {
    const unregisteredSourceEvidence = JSON.stringify([
      {
        locator: { sourceSegmentId: secondSegmentId },
        sourceVersion: { entityId: "c25-unregistered-source", versionId: "1" },
      },
    ]);
    const riskInput = await insertIncompleteRecord("evidence-source-outside-scope", {
      evidence_references: unregisteredSourceEvidence,
    });
    const result = await fixture.riskInputFacts.readRiskInputFacts(
      await readRequest({
        requestId: "seam-evidence-source-outside-scope",
        riskInput,
        spatialScopeRefs: [fixture.businessSpatialScopeRef],
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
    );
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 180_000);

  it("只读投影可重复重放：事实相同且不新增记录、收据或事件", async () => {
    const read = async (requestId: string) =>
      fixture.riskInputFacts.readRiskInputFacts(
        await readRequest({
          requestId,
          riskInput: recordRef,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      );
    const first = await read("seam-replay-1");
    const second = await read("seam-replay-2");
    expect(second.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || second.kind !== "succeeded") return;
    expect(second.facts).toEqual(first.facts);

    const count = async (table: string) => {
      const result = await fixture.postgres.postgres.adminPool.query<{ count: string }>(
        `SELECT count(*) FROM ${table} WHERE project_id = $1`,
        [fixture.projectId],
      );
      return Number(result.rows[0]?.count ?? "-1");
    };
    const snapshot = async () => ({
      records: await count("business.risk_assessment_records"),
      receipts: await count("business.command_receipts"),
      events: await count("outbox.events"),
    });
    const before = await snapshot();
    await read("seam-replay-3");
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("工件身份或字段证据不符时按契约失败闭合，不产出部分事实", async () => {
    const segmentId = secondSegmentId;
    const registeredEvidence = {
      locator: { sourceSegmentId: segmentId },
      sourceVersion: fixture.sourceVersionRef.reference,
    };
    const unregisteredEvidence = {
      locator: { sourceSegmentId: "c25-segment-never-registered" },
      sourceVersion: fixture.sourceVersionRef.reference,
    };
    const field = (evidenceReferences: unknown[]) => ({
      documentType: "external-risk-event",
      fieldPath: ["probability", "modelConfidence"],
      value: 0.8,
      evidenceReferences,
    });
    const cases = [
      {
        name: "project-mismatch",
        body: {
          schemaVersion: "1",
          projectId: "project-not-this-one",
          externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
          externalEventKey: "MISMATCH",
          fields: [field([registeredEvidence])],
        },
      },
      {
        name: "event-key-mismatch",
        body: {
          schemaVersion: "1",
          projectId: fixture.projectId,
          externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
          externalEventKey: "external-event-not-this-one",
          fields: [field([registeredEvidence])],
        },
      },
      {
        name: "source-ref-mismatch",
        body: {
          schemaVersion: "1",
          projectId: fixture.projectId,
          externalSourceRef: { entityId: "external-risk-platform", versionId: "7" },
          externalEventKey: "MISMATCH",
          fields: [field([registeredEvidence])],
        },
      },
      {
        name: "evidence-not-registered",
        body: {
          schemaVersion: "1",
          projectId: fixture.projectId,
          externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
          externalEventKey: "MISMATCH",
          fields: [field([unregisteredEvidence])],
        },
      },
    ] as const;
    for (const testCase of cases) {
      // C11 仍然接受任意 JSON 正文登记：登记成功不是可评估。
      const riskInput = await fixture.registerExternalRiskEventWithBody({
        suffix: `mismatch-${testCase.name}`,
        body: testCase.body,
      });
      const result = await fixture.riskInputFacts.readRiskInputFacts(
        await readRequest({
          requestId: `seam-mismatch-${testCase.name}`,
          riskInput,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      );
      expect(result, testCase.name).toMatchObject({
        kind: "failed",
        error: { code: "UNSUPPORTED_CONTRACT" },
      });
    }
  }, 240_000);

  it("来源发布变化不改写旧事件事实：只读原精确工件与原证据", async () => {
    const read = async (requestId: string, riskInput: unknown) =>
      fixture.riskInputFacts.readRiskInputFacts(
        await readRequest({
          requestId,
          riskInput,
          spatialScopeRefs: [fixture.businessSpatialScopeRef],
          sourceVersionRefs: [fixture.sourceVersionRef],
        }),
      );
    const before = await read("seam-stability-before", eventRef);
    expect(before.kind).toBe("succeeded");
    if (before.kind !== "succeeded") return;

    // 登记一个更新的外部事件后，旧事件的字段与证据必须逐字不变：reader 没有「最新」查找路径。
    const newer = await fixture.registerExternalRiskEventWithBody({
      suffix: "newer",
      body: ExternalRiskEventFactsArtifactV1Schema.parse({
        schemaVersion: "1",
        projectId: fixture.projectId,
        externalSourceRef: { entityId: "external-risk-platform", versionId: "2" },
        externalEventKey: "external-event-newer",
        fields: [
          {
            documentType: "external-risk-event",
            fieldPath: ["probability", "modelConfidence"],
            value: 0.11,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: secondSegmentId },
                sourceVersion: fixture.sourceVersionRef.reference,
              },
            ],
          },
        ],
      }),
    });
    const after = await read("seam-stability-after", eventRef);
    expect(after.kind).toBe("succeeded");
    if (after.kind !== "succeeded") return;
    expect(after.facts).toEqual(before.facts);
    // 精确引用错版本仍是同形授权拒绝，不退化成「取最新」。
    const bumped = await read("seam-stability-bumped", {
      ...eventRef,
      reference: { ...eventRef.reference, versionId: "7" },
    });
    expect(bumped).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(newer.reference.entityId).not.toBe(eventRef.reference.entityId);
  }, 240_000);

  it("入口来源授权未覆盖记录已保存来源时关闭失败（来源撤权/不覆盖目标）", async () => {
    // 授权上下文不含任何来源授权：记录已保存的来源无法被证明覆盖，读取必须失败而不是退化为空来源。
    const uncovered = await readRequest({
      requestId: "seam-source-uncovered",
      riskInput: recordRef,
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [],
    });
    const result = await fixture.riskInputFacts.readRiskInputFacts(uncovered);
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 180_000);

  it("外部分支缺目标与错引用按同形授权拒绝", async () => {
    const denial = await fixture.riskInputFacts.readRiskInputFacts(
      await readRequest({
        requestId: "seam-event-absent",
        riskInput: {
          kind: "external-risk-event",
          reference: { entityId: "c25-external-event-absent", versionId: "1" },
        },
        spatialScopeRefs: [fixture.businessSpatialScopeRef],
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
    );
    expect(denial).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 180_000);

  it("跨工程的精确引用按同形拒绝，不枚举记录存在性", async () => {
    const request = await readRequest({
      requestId: "seam-foreign",
      riskInput: recordRef,
      spatialScopeRefs: [fixture.businessSpatialScopeRef],
      sourceVersionRefs: [fixture.sourceVersionRef],
    });
    const foreign = await fixture.riskInputFacts.readRiskInputFacts({
      ...request,
      authorization: { ...request.authorization, projectId: fixture.foreignProjectId() },
    } as never);
    const missing = await fixture.riskInputFacts.readRiskInputFacts(
      await readRequest({
        requestId: "seam-foreign-missing",
        riskInput: {
          kind: "standardized-risk-record",
          reference: { entityId: "c25-record-absent-foreign", versionId: "1" },
        },
        spatialScopeRefs: [fixture.businessSpatialScopeRef],
        sourceVersionRefs: [fixture.sourceVersionRef],
      }),
    );
    // 跨工程与不存在必须是同形拒绝，否则存在性本身就是泄露。
    expect(foreign).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(missing).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  }, 180_000);
});

/**
 * 外部事件分支的完整链路：结构化正文经 C11 正式登记后同样要能走完准备冻结、输入冻结、
 * 正式评估并持久回读，证明两个 XOR 分支共用同一个组合事实提供者。
 */
describe("外部风险事件分支生产接缝", () => {
  let fixture: ProductionAssessmentSeamsFixtureV1;
  let eventRef: ExternalRiskEventRefV1;

  beforeAll(async () => {
    fixture = await startProductionAssessmentSeamsFixture({
      riskInputShape: "external-risk-event",
    });
    const segmentId = `${fixture.sourceVersionRef.reference.entityId}-chapter_1-segment_1`;
    eventRef = await fixture.registerExternalRiskEventWithBody({
      suffix: "production",
      body: ExternalRiskEventFactsArtifactV1Schema.parse({
        schemaVersion: "1",
        projectId: fixture.projectId,
        externalSourceRef: { entityId: "external-risk-platform", versionId: "1" },
        externalEventKey: "external-event-production",
        fields: [
          {
            documentType: "external-risk-event",
            fieldPath: ["probability", "modelConfidence"],
            value: 0.8,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: segmentId },
                sourceVersion: fixture.sourceVersionRef.reference,
              },
            ],
          },
          {
            documentType: "external-risk-event",
            fieldPath: ["probability", "compositeConfidence"],
            value: 0.7,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: segmentId },
                sourceVersion: fixture.sourceVersionRef.reference,
              },
            ],
          },
        ],
      }),
    });
  }, 300_000);

  afterAll(async () => {
    await fixture?.postgres.close();
  }, 60_000);

  it("结构化外部事件走完准备冻结、输入冻结、正式评估与持久回读", async () => {
    const preparation = await fixture.freezePreparation({
      suffix: "seam-event-production",
      entryMode: "assess",
      triggerReasonCode: "manual-assessment",
      riskInput: eventRef,
      monitoringSnapshotRefs: fixture.monitoringSnapshotRefs,
    });
    expect(preparation.kind).toBe("assessment-preparation-snapshot");
    const prepared = await fixture.engine.prepare(
      (await fixture.prepareCommand({
        commandId: "seam-event-prepare-production",
        preparation,
      })) as never,
    );
    expect(prepared).toMatchObject({ kind: "succeeded" });
    if (prepared.kind !== "succeeded") return;
    const evaluation = await fixture.engine.evaluate(
      (await fixture.evaluateCommand({
        commandId: "seam-event-evaluate-production",
        inputSnapshotRef: prepared.result.assessmentInputSnapshotRef,
      })) as never,
    );
    expect(evaluation.kind).toBe("succeeded");

    const records = await fixture.postgres.postgres.adminPool.query<{
      risk_input_kind: string;
      external_risk_event_id: string | null;
    }>(
      "SELECT risk_input_kind, external_risk_event_id FROM business.risk_assessment_records WHERE project_id = $1",
      [fixture.projectId],
    );
    expect(records.rows[0]).toMatchObject({
      risk_input_kind: "external-risk-event",
      external_risk_event_id: eventRef.reference.entityId,
    });
  }, 240_000);
});

/** 两个 owning reader 都不应被组合工厂以外的路径直接依赖，避免重新出现构造循环。 */
describe("组合工厂不依赖 C11 registry 实例", () => {
  it("只按 XOR kind 分派，不做查询也不改写调用身份", async () => {
    const calls: string[] = [];
    const branch = (name: string): RiskInputFactsReaderV1 => ({
      readRiskInputFacts: async (input) => {
        calls.push(name);
        return { kind: "succeeded", facts: input as never };
      },
    });
    const reader = createRiskInputFactsReader({
      standardizedRiskRecord: branch("record"),
      externalRiskEvent: branch("event"),
    });
    const authorization = {
      schemaVersion: "1" as const,
      authorizationContextRef: {
        kind: "authorization-context" as const,
        reference: { entityId: "auth-1", versionId: "1" },
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["engineering-data.read" as const],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: T0,
      invocation: { kind: "human" as const },
    };
    const base = {
      requestId: "compose-1",
      idempotencyKey: "compose-1",
      requestedAt: T0,
      authorization,
    };
    await reader.readRiskInputFacts({
      ...base,
      riskInput: { kind: "standardized-risk-record", reference: { entityId: "r", versionId: "1" } },
    } as never);
    await reader.readRiskInputFacts({
      ...base,
      requestId: "compose-2",
      idempotencyKey: "compose-2",
      riskInput: { kind: "external-risk-event", reference: { entityId: "e", versionId: "1" } },
    } as never);
    expect(calls).toEqual(["record", "event"]);
    const closed = await reader.readRiskInputFacts({
      ...base,
      riskInput: { kind: "other" },
    } as never);
    expect(closed).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT" },
    });
  });

  it("非法读取身份和时间在组合层及 owning readers 均返回类型化契约失败", async () => {
    const authorization = {
      schemaVersion: "1" as const,
      authorizationContextRef: {
        kind: "authorization-context" as const,
        reference: { entityId: "auth-1", versionId: "1" },
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["engineering-data.read" as const],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: T0,
      invocation: { kind: "human" as const },
    };
    const branches: RiskInputFactsReaderV1 = {
      readRiskInputFacts: async () => {
        throw new Error("invalid input must not be dispatched");
      },
    };
    const readers = [
      createRiskInputFactsReader({ standardizedRiskRecord: branches, externalRiskEvent: branches }),
      createPostgresStandardizedRiskInputFactsReader({
        db: {},
        authorization: {
          verify: async () => {
            throw new Error("must not verify");
          },
        } as never,
      }),
      createPostgresExternalRiskInputFactsReader({
        db: {},
        authorization: {
          verify: async () => {
            throw new Error("must not verify");
          },
        } as never,
        artifactStore: {} as never,
      }),
    ];
    const invalidRequests = [
      null,
      undefined,
      {
        requestId: "",
        idempotencyKey: "invalid-request-id",
        requestedAt: T0,
        authorization,
        riskInput: {
          kind: "standardized-risk-record",
          reference: { entityId: "record-1", versionId: "1" },
        },
      },
      {
        requestId: "invalid-request-time",
        idempotencyKey: "invalid-request-time",
        requestedAt: "bad",
        authorization,
        riskInput: {
          kind: "standardized-risk-record",
          reference: { entityId: "record-1", versionId: "1" },
        },
      },
    ];
    for (const reader of readers) {
      for (const request of invalidRequests) {
        await expect(
          Promise.resolve().then(() => reader.readRiskInputFacts(request as never)),
        ).resolves.toMatchObject({
          kind: "failed",
          error: { code: "UNSUPPORTED_CONTRACT" },
        });
      }
    }
  });
});
