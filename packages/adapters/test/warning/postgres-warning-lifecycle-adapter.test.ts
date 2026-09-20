import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WarningRecordSchema } from "@riskflow/contracts/records";

import { createPostgresRuntime } from "../../src/postgres/pool.js";
import * as warningMigration from "../../src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.js";
import { startWarningLifecycleFixture, type WarningLifecyclePostgresFixtureV1 } from "./fixture.js";

const WARNING_TABLES = [
  "warning_records",
  "warning_response_tasks",
  "warning_response_task_versions",
  "warning_response_task_warnings",
  "notification_intents",
  "in_app_notifications",
  "warning_acknowledgements",
];

describe("C26 预警与处置任务 PostgreSQL 链", () => {
  let fixture: WarningLifecyclePostgresFixtureV1 | undefined;

  beforeAll(async () => {
    fixture = await startWarningLifecycleFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 120_000);

  it("标准风险链从 C25 评估记录生成规范预警、唯一任务版本、通知意图、审计与事件", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "g25" });
    expect(assessment.triggerTypes.length).toBeGreaterThanOrEqual(2);
    const tasksBefore = await state.taskRows();
    const versionsBefore =
      tasksBefore[0] === undefined
        ? 0
        : (await state.taskVersionRows(tasksBefore[0].taskId)).length;
    const before = {
      receipts: await state.countReceipts("warning-response.open"),
      audit: await state.countAuditEntries("warning-response.open"),
      events: await state.countEvents("warning.warning-recorded.v1"),
    };

    const opened = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-g25",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(opened.kind).toBe("succeeded");
    if (opened.kind !== "succeeded") return;
    const result = opened.result;

    // 预警数等于评估记录的不同触发类型数，且每条都只保留本类型的触发指标。
    expect(result.warningRecordRefs).toHaveLength(assessment.triggerTypes.length);
    expect(assessment.triggerTypes.length).toBeGreaterThanOrEqual(3);
    const persisted = await state.warningRows({
      assessmentRecordRef: assessment.assessmentRecordRef,
    });
    expect(persisted.map((row) => row.triggerType).sort()).toEqual(
      [...assessment.triggerTypes].sort(),
    );
    for (const row of persisted) {
      const record = WarningRecordSchema.parse(row.payload);
      expect(record.warningRecordId).toBe(row.warningRecordId);
      expect(record.assessmentRecordId).toBe(assessment.assessmentRecordRef.reference.entityId);
      expect(record.warningLevel).toBe(assessment.riskLevel);
      expect(record.notificationStatus).toBe("intent-recorded");
      expect(record.triggerIndicators.every((entry) => entry.triggerType === row.triggerType)).toBe(
        true,
      );
      expect(record.evidenceReferences.length).toBeGreaterThan(0);
      expect(row.contentDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(row.auditEntryId).toBe("audit-c26-open-g25:warning-open");
      if (row.triggerType === "趋势/加速度/异常评分越限") {
        // 同类多指标规范归入同一条预警，不按指标拆分。
        expect(record.triggerIndicators.length).toBe(2);
      }
    }

    // 唯一处置任务：同一归集键下只推进一个版本，且所有预警共享该版本。
    expect(result.warningResponseTaskRefs).toHaveLength(1);
    const taskRef = result.warningResponseTaskRefs[0]!;
    const tasks = await state.taskRows();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskId).toBe(taskRef.reference.entityId);
    expect(tasks[0]!.status).toBe("open");
    expect(tasks[0]!.currentVersionId).toBe(taskRef.reference.versionId);
    expect(Number(taskRef.reference.versionId)).toBe(versionsBefore + 1);
    expect(await state.taskVersionRows(taskRef.reference.entityId)).toHaveLength(
      versionsBefore + 1,
    );
    const links = (await state.taskLinkRows(taskRef.reference.entityId)).filter(
      (link) => link.firstIncludedVersionId === taskRef.reference.versionId,
    );
    expect(links.map((link) => link.warningRecordId).sort()).toEqual(
      result.warningRecordRefs.map((ref) => ref.reference.entityId).sort(),
    );

    // 通知意图：每条预警 × 每个接收人一条，渠道固定 in-app，任务引用与事件一致。
    expect(result.notificationIntentRefs).toHaveLength(
      result.warningRecordRefs.length * state.recipients.length,
    );
    expect(new Set(result.notificationIntentRefs.map((ref) => ref.reference.entityId)).size).toBe(
      result.notificationIntentRefs.length,
    );
    for (const warningRef of result.warningRecordRefs) {
      const intents = await state.intentRows(warningRef.reference.entityId);
      expect(intents.map((intent) => intent.recipientActorId)).toEqual(
        [...state.recipients].sort(),
      );
      expect(intents.every((intent) => intent.channel === "in-app")).toBe(true);
      expect(intents.every((intent) => intent.taskId === taskRef.reference.entityId)).toBe(true);
      expect(intents.every((intent) => intent.taskVersionId === taskRef.reference.versionId)).toBe(
        true,
      );
      expect(
        intents.every(
          (intent) => intent.notificationPolicyEntityId === state.notificationPolicyRef.entityId,
        ),
      ).toBe(true);
    }

    // 审计、回执与每条新预警一个事件；事件只携带公共引用。
    expect(await state.countReceipts("warning-response.open")).toBe(before.receipts + 1);
    expect(await state.countAuditEntries("warning-response.open")).toBe(before.audit + 1);
    expect(await state.countEvents("warning.warning-recorded.v1")).toBe(
      before.events + result.warningRecordRefs.length,
    );
    const event = await state.lastEvent("warning.warning-recorded.v1");
    expect(event?.aggregateRef).toEqual(taskRef);
    expect(event?.producerCommandId).toBe("c26-open-g25");
    if (event?.eventType === "warning.warning-recorded.v1") {
      expect(event.payload.notificationIntentRefs.length).toBe(state.recipients.length);
      expect(event.payload.warningRecordRef.kind).toBe("warning-record");
    }

    // G2.5 追溯链：任务的空间身份可回溯到预警引用的 C25 准备快照。
    const taskRow = (await state.taskRows()).find(
      (task) => task.taskId === taskRef.reference.entityId,
    )!;
    expect(await state.taskSpatialScopeTrace(taskRef.reference.entityId)).toBe(
      taskRow.spatialScopeEntityId,
    );
    expect(taskRow.riskInputEntityId).toBe("risk-record-c25");
    expect(assessment.evidenceSegmentIds.length).toBeGreaterThan(0);
  }, 240_000);

  it("同键重试与不同命令的语义重复都不重复预警、任务版本、意图、审计或事件", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "replay" });
    const command = await state.openCommand({
      commandId: "c26-open-replay",
      assessmentRecordRef: assessment.assessmentRecordRef,
    });
    const first = await state.adapter.open(command);
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    const counts = {
      warnings: await state.countRows("business.warning_records"),
      tasks: await state.countRows("business.warning_response_tasks"),
      versions: await state.countRows("business.warning_response_task_versions"),
      intents: await state.countRows("business.notification_intents"),
      receipts: await state.countReceipts("warning-response.open"),
      audit: await state.countAuditEntries("warning-response.open"),
      events: await state.countEvents("warning.warning-recorded.v1"),
    };

    const replay = await state.adapter.open(command);
    expect(replay.kind).toBe("succeeded");
    if (replay.kind === "succeeded") {
      expect(replay.result).toEqual(first.result);
    }

    const otherCommand = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-replay-second",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(otherCommand.kind).toBe("succeeded");
    if (otherCommand.kind === "succeeded") {
      expect(otherCommand.result).toEqual(first.result);
    }

    expect(await state.countRows("business.warning_records")).toBe(counts.warnings);
    expect(await state.countRows("business.warning_response_tasks")).toBe(counts.tasks);
    expect(await state.countRows("business.warning_response_task_versions")).toBe(counts.versions);
    expect(await state.countRows("business.notification_intents")).toBe(counts.intents);
    expect(await state.countEvents("warning.warning-recorded.v1")).toBe(counts.events);
    // 同键重试不新增回执；不同命令新增一次回执与审计，但不新增预警事实。
    expect(await state.countReceipts("warning-response.open")).toBe(counts.receipts + 1);
    expect(await state.countAuditEntries("warning-response.open")).toBe(counts.audit + 1);
  }, 240_000);

  it("同键异载荷返回 IDEMPOTENCY_CONFLICT 且既有事实不变", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "conflict" });
    const other = await state.assess({ suffix: "conflict-other" });
    const command = await state.openCommand({
      commandId: "c26-open-conflict",
      assessmentRecordRef: assessment.assessmentRecordRef,
    });
    const first = await state.adapter.open(command);
    expect(first.kind).toBe("succeeded");
    const warningsBefore = await state.countRows("business.warning_records");

    const conflicting = await state.adapter.open({
      ...command,
      payload: { ...command.payload, assessmentRecordRef: other.assessmentRecordRef },
    });
    expect(conflicting.kind).toBe("failed");
    if (conflicting.kind === "failed") {
      expect(conflicting.error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
    expect(await state.countRows("business.warning_records")).toBe(warningsBefore);
    const replay = await state.adapter.open(command);
    expect(replay.kind).toBe("succeeded");
    if (replay.kind === "succeeded" && first.kind === "succeeded") {
      expect(replay.result).toEqual(first.result);
    }
  }, 240_000);

  it("事务内任一写入失败时本次命令整体回滚并可安全重试", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "rollback" });
    const before = {
      warnings: await state.countRows("business.warning_records"),
      tasks: await state.countRows("business.warning_response_tasks"),
      intents: await state.countRows("business.notification_intents"),
      events: await state.countEvents("warning.warning-recorded.v1"),
      receipts: await state.countReceipts("warning-response.open"),
    };
    await state.preinsertAuditConflict("c26-open-rollback");
    const failed = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-rollback",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(failed.kind).toBe("failed");
    expect(await state.countRows("business.warning_records")).toBe(before.warnings);
    expect(await state.countRows("business.warning_response_tasks")).toBe(before.tasks);
    expect(await state.countRows("business.notification_intents")).toBe(before.intents);
    expect(await state.countEvents("warning.warning-recorded.v1")).toBe(before.events);
    expect(await state.countReceipts("warning-response.open")).toBe(before.receipts);

    await state.clearAuditConflict("c26-open-rollback");
    const retried = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-rollback",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(retried.kind).toBe("succeeded");
    if (retried.kind === "succeeded") {
      expect(retried.result.warningRecordRefs.length).toBe(assessment.triggerTypes.length);
    }
  }, 240_000);

  it("持续越限归集到同一任务的新版本，关闭后产生新任务实体", async () => {
    const state = fixture!;
    const first = await state.assess({ suffix: "series-1" });
    const openedFirst = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-series-1",
        assessmentRecordRef: first.assessmentRecordRef,
      }),
    );
    expect(openedFirst.kind).toBe("succeeded");
    if (openedFirst.kind !== "succeeded") return;
    const taskRef = openedFirst.result.warningResponseTaskRefs[0]!;

    const second = await state.assess({ suffix: "series-2" });
    const openedSecond = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-series-2",
        assessmentRecordRef: second.assessmentRecordRef,
      }),
    );
    expect(openedSecond.kind).toBe("succeeded");
    if (openedSecond.kind !== "succeeded") return;
    const secondTaskRef = openedSecond.result.warningResponseTaskRefs[0]!;
    expect(secondTaskRef.reference.entityId).toBe(taskRef.reference.entityId);
    expect(Number(secondTaskRef.reference.versionId)).toBeGreaterThan(
      Number(taskRef.reference.versionId),
    );
    expect(await state.taskVersionRows(taskRef.reference.entityId)).toHaveLength(
      Number(secondTaskRef.reference.versionId),
    );
    expect((await state.taskRows()).filter((task) => task.status === "open")).toHaveLength(1);
    const links = await state.taskLinkRows(taskRef.reference.entityId);
    expect(
      links.filter((link) => link.firstIncludedVersionId === taskRef.reference.versionId),
    ).toHaveLength(first.triggerTypes.length);
    expect(
      links.filter((link) => link.firstIncludedVersionId === secondTaskRef.reference.versionId),
    ).toHaveLength(second.triggerTypes.length);

    // 历史链不受后续版本影响：重放第一条命令仍返回创建时的任务版本。
    const replayFirst = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-series-1",
        assessmentRecordRef: first.assessmentRecordRef,
      }),
    );
    expect(replayFirst.kind).toBe("succeeded");
    if (replayFirst.kind === "succeeded") {
      expect(replayFirst.result).toEqual(openedFirst.result);
    }

    // 已关闭任务不被重新使用：同键的新预警创建新任务实体。
    await state.closeTask(taskRef.reference.entityId);
    const third = await state.assess({ suffix: "series-3" });
    const openedThird = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-series-3",
        assessmentRecordRef: third.assessmentRecordRef,
      }),
    );
    expect(openedThird.kind).toBe("succeeded");
    if (openedThird.kind !== "succeeded") return;
    const thirdTaskRef = openedThird.result.warningResponseTaskRefs[0]!;
    expect(thirdTaskRef.reference.entityId).not.toBe(taskRef.reference.entityId);
    expect(thirdTaskRef.reference.versionId).toBe("1");
    const tasks = await state.taskRows();
    expect(tasks.filter((task) => task.status === "open")).toHaveLength(1);
    expect(tasks.find((task) => task.taskId === taskRef.reference.entityId)?.status).toBe("closed");
  }, 300_000);

  it("不同命令并发打开同一评估只产生一组规范事实", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "concurrent" });
    const openTask = (await state.taskRows()).find((task) => task.status === "open");
    const versionsBefore =
      openTask === undefined ? 0 : (await state.taskVersionRows(openTask.taskId)).length;
    const [left, right] = await Promise.all([
      state
        .openCommand({
          commandId: "c26-open-concurrent-a",
          assessmentRecordRef: assessment.assessmentRecordRef,
        })
        .then((command) => state.adapter.open(command)),
      state
        .openCommand({
          commandId: "c26-open-concurrent-b",
          assessmentRecordRef: assessment.assessmentRecordRef,
        })
        .then((command) => state.adapter.open(command)),
    ]);
    const results = [left, right];
    const succeeded = results.filter((result) => result.kind === "succeeded");
    const retryable = results.filter(
      (result) => result.kind === "failed" && result.error.retryable,
    );
    expect(succeeded.length + retryable.length).toBe(2);
    for (const result of succeeded) {
      if (result.kind !== "succeeded") continue;
      expect(result.result.warningRecordRefs).toHaveLength(assessment.triggerTypes.length);
    }
    const rows = await state.warningRows({
      assessmentRecordRef: assessment.assessmentRecordRef,
    });
    expect(rows).toHaveLength(assessment.triggerTypes.length);
    const taskRefs = [
      ...new Set(
        succeeded.map((result) => JSON.stringify(result.result.warningResponseTaskRefs[0])),
      ),
    ];
    expect(taskRefs).toHaveLength(1);
    const taskId = succeeded[0]!.result.warningResponseTaskRefs[0]!.reference.entityId;
    expect(await state.taskVersionRows(taskId)).toHaveLength(versionsBefore + 1);
  }, 300_000);

  it("策略与授权失败闭合且不产生副作用", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "policy" });
    const warningsBefore = await state.countRows("business.warning_records");
    const receiptsBefore = await state.countReceipts("warning-response.open");

    const mismatched = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-policy-mismatch",
        assessmentRecordRef: assessment.assessmentRecordRef,
        aggregationPolicyRef: { entityId: "warning-aggregation-policy-other", versionId: "7" },
      }),
    );
    expect(mismatched.kind).toBe("failed");
    if (mismatched.kind === "failed") {
      expect(mismatched.error.code).toBe("STALE_VERSION");
    }

    state.setPolicyAvailability("missing");
    const unresolved = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-policy-missing",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    state.setPolicyAvailability("available");
    expect(unresolved.kind).toBe("failed");
    if (unresolved.kind === "failed") {
      expect(unresolved.error.code).toBe("BUSINESS_BLOCKED");
      // 最小披露：错误只含稳定代码与引用，不含评估或证据正文。
      expect(JSON.stringify(unresolved.error)).not.toContain("triggerIndicators");
      expect(JSON.stringify(unresolved.error)).not.toContain("segment-");
    }

    const missingAssessment = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-missing-assessment",
        assessmentRecordRef: await state.assessWithMissingAssessment(),
      }),
    );
    expect(missingAssessment.kind).toBe("failed");
    if (missingAssessment.kind === "failed") {
      expect(missingAssessment.error.code).toBe("BUSINESS_BLOCKED");
    }

    // 未获准工程的调用方得到不可枚举拒绝，且不泄露目标是否存在。
    const unauthorized = await state.adapter.open(
      state.foreignOpenCommand({
        commandId: "c26-open-foreign-project",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(unauthorized.kind).toBe("failed");
    if (unauthorized.kind === "failed") {
      expect(unauthorized.error.code).toBe("AUTHORIZATION_DENIED");
    }

    expect(await state.countRows("business.warning_records")).toBe(warningsBefore);
    expect(await state.countReceipts("warning-response.open")).toBe(receiptsBefore);
  }, 240_000);

  it("通知策略未解析到接收人时在提交前失败", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "recipients" });
    state.setNotificationPolicy([]);
    const opened = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-no-recipient",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    state.setNotificationPolicy(state.recipients);
    expect(opened.kind).toBe("failed");
    expect(
      await state.warningRows({ assessmentRecordRef: assessment.assessmentRecordRef }),
    ).toHaveLength(0);
  }, 240_000);

  it("确认只追加独立事实并保持预警、任务与通知状态不变", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "ack" });
    const opened = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-ack",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(opened.kind).toBe("succeeded");
    if (opened.kind !== "succeeded") return;
    const warningRef = opened.result.warningRecordRefs[0]!;
    const taskRef = opened.result.warningResponseTaskRefs[0]!;
    const warningsBefore = await state.warningRows({
      assessmentRecordRef: assessment.assessmentRecordRef,
    });
    const intentsBefore = await state.intentRows(warningRef.reference.entityId);
    const taskBefore = (await state.taskRows()).find(
      (task) => task.taskId === taskRef.reference.entityId,
    )!;
    const auditBefore = await state.countAuditEntries("warning-response.acknowledge");
    const eventsBefore = await state.countEvents("warning.warning-acknowledged.v1");
    const receiptsBefore = await state.countReceipts("warning-response.acknowledge");

    const acknowledged = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-1",
        warningRecordRef: warningRef,
        warningResponseTaskRef: taskRef,
      })) as never,
    );
    expect(acknowledged).toEqual({
      kind: "succeeded",
      result: {
        kind: "acknowledgement",
        status: "acknowledged",
        warningRecordRef: warningRef,
        warningResponseTaskRef: taskRef,
      },
    });
    const rows = await state.acknowledgementRows({ warningRecordRef: warningRef });
    expect(rows).toEqual([
      { acknowledgedByActorId: state.managerId, taskVersionId: taskRef.reference.versionId },
    ]);
    expect(await state.countAuditEntries("warning-response.acknowledge")).toBe(auditBefore + 1);
    expect(await state.countEvents("warning.warning-acknowledged.v1")).toBe(eventsBefore + 1);
    expect(await state.countReceipts("warning-response.acknowledge")).toBe(receiptsBefore + 1);
    const event = await state.lastEvent("warning.warning-acknowledged.v1");
    expect(event?.aggregateRef).toEqual(taskRef);

    const unauthorizedCommand = await state.acknowledgeCommand({
      commandId: "c26-ack-invalid-authorization",
      warningRecordRef: warningRef,
      warningResponseTaskRef: taskRef,
    });
    const unauthorized = await state.adapter.acknowledge({
      ...unauthorizedCommand,
      authorization: {
        ...unauthorizedCommand.authorization,
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "authorization-absent", versionId: "1" },
        },
      },
    } as never);
    expect(unauthorized.kind).toBe("failed");
    if (unauthorized.kind === "failed") {
      expect(unauthorized.error.code).toBe("AUTHORIZATION_DENIED");
    }

    // 确认不解除风险：预警、任务、意图与投递状态全部保持原值。
    expect(
      await state.warningRows({ assessmentRecordRef: assessment.assessmentRecordRef }),
    ).toEqual(warningsBefore);
    expect(await state.intentRows(warningRef.reference.entityId)).toEqual(intentsBefore);
    const taskAfter = (await state.taskRows()).find(
      (task) => task.taskId === taskRef.reference.entityId,
    )!;
    expect(taskAfter).toEqual(taskBefore);
    expect(await state.notificationRows(intentsBefore.map((intent) => intent.intentId))).toEqual(
      [],
    );

    // 同键重试返回首次结果，同键异载荷优先返回幂等冲突，不重复任何事实。
    const replay = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-1",
        warningRecordRef: warningRef,
        warningResponseTaskRef: taskRef,
      })) as never,
    );
    expect(replay).toEqual(acknowledged);
    const idempotencyConflict = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-conflict",
        idempotencyKey: "c26-ack-1",
        warningRecordRef: {
          ...warningRef,
          reference: { ...warningRef.reference, entityId: "warning-absent" },
        },
        warningResponseTaskRef: taskRef,
      })) as never,
    );
    expect(idempotencyConflict.kind).toBe("failed");
    if (idempotencyConflict.kind === "failed") {
      expect(idempotencyConflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    }

    // 不同命令再次确认同一精确配对返回业务冲突。
    const second = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-2",
        warningRecordRef: warningRef,
        warningResponseTaskRef: taskRef,
      })) as never,
    );
    expect(second.kind).toBe("failed");
    if (second.kind === "failed") {
      expect(second.error.code).toBe("BUSINESS_BLOCKED");
    }
    expect(await state.acknowledgementRows({ warningRecordRef: warningRef })).toHaveLength(1);
    expect(await state.countEvents("warning.warning-acknowledged.v1")).toBe(eventsBefore + 1);
  }, 300_000);

  it("不匹配任务版本与陈旧任务版本分别返回业务阻塞和 STALE_VERSION", async () => {
    const state = fixture!;
    const first = await state.assess({ suffix: "version-1" });
    const second = await state.assess({ suffix: "version-2" });
    const openedFirst = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-version-1",
        assessmentRecordRef: first.assessmentRecordRef,
      }),
    );
    const openedSecond = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-version-2",
        assessmentRecordRef: second.assessmentRecordRef,
      }),
    );
    expect(openedFirst.kind).toBe("succeeded");
    expect(openedSecond.kind).toBe("succeeded");
    if (openedFirst.kind !== "succeeded" || openedSecond.kind !== "succeeded") return;
    const advancedTaskRef = openedSecond.result.warningResponseTaskRefs[0]!;
    const staleWarningRef = openedFirst.result.warningRecordRefs[0]!;

    const stale = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-stale",
        warningRecordRef: staleWarningRef,
        warningResponseTaskRef: {
          ...advancedTaskRef,
          reference: { ...advancedTaskRef.reference, versionId: "1" },
        },
      })) as never,
    );
    expect(stale.kind).toBe("failed");
    if (stale.kind === "failed") {
      expect(stale.error.code).toBe("STALE_VERSION");
    }

    const mismatched = await state.adapter.acknowledge(
      (await state.acknowledgeCommand({
        commandId: "c26-ack-mismatch",
        warningRecordRef: staleWarningRef,
        warningResponseTaskRef: {
          kind: "warning-response-task",
          reference: { entityId: "task-absent", versionId: "1" },
        },
      })) as never,
    );
    expect(mismatched.kind).toBe("failed");
    if (mismatched.kind === "failed") {
      expect(mismatched.error.code).toBe("AUTHORIZATION_DENIED");
    }
    expect(await state.acknowledgementRows({ warningRecordRef: staleWarningRef })).toEqual([]);
  }, 300_000);

  it("并发确认同一精确配对只建立一个确认", async () => {
    const state = fixture!;
    const assessment = await state.assess({ suffix: "ack-concurrent" });
    const opened = await state.adapter.open(
      await state.openCommand({
        commandId: "c26-open-ack-concurrent",
        assessmentRecordRef: assessment.assessmentRecordRef,
      }),
    );
    expect(opened.kind).toBe("succeeded");
    if (opened.kind !== "succeeded") return;
    const warningRef = opened.result.warningRecordRefs[0]!;
    const taskRef = opened.result.warningResponseTaskRefs[0]!;
    const [left, right] = await Promise.all([
      state
        .acknowledgeCommand({
          commandId: "c26-ack-concurrent-a",
          warningRecordRef: warningRef,
          warningResponseTaskRef: taskRef,
        })
        .then((command) => state.adapter.acknowledge(command as never)),
      state
        .acknowledgeCommand({
          commandId: "c26-ack-concurrent-b",
          warningRecordRef: warningRef,
          warningResponseTaskRef: taskRef,
        })
        .then((command) => state.adapter.acknowledge(command as never)),
    ]);
    const results = [left, right];
    expect(results.filter((result) => result.kind === "succeeded")).toHaveLength(1);
    expect(
      results
        .filter((result) => result.kind === "failed")
        .map((result) => (result.kind === "failed" ? result.error.code : "")),
    ).toEqual(["BUSINESS_BLOCKED"]);
    expect(await state.acknowledgementRows({ warningRecordRef: warningRef })).toHaveLength(1);
    expect(
      (await state.countEvents("warning.warning-acknowledged.v1", "c26-ack-concurrent-a")) +
        (await state.countEvents("warning.warning-acknowledged.v1", "c26-ack-concurrent-b")),
    ).toBe(1);
    expect((await state.lastEvent("warning.warning-acknowledged.v1"))?.producerCommandId).toBe(
      "c26-ack-concurrent-a",
    );
  }, 300_000);

  it("000044 迁移可重复 up 且逆序 down 后能重新建立七表", async () => {
    const state = fixture!;
    const migrator = state.c25.postgres.postgres.migrator;
    const runtime = createPostgresRuntime(migrator, "riskflow_migrator");
    try {
      const tableCount = async (): Promise<number> => {
        const result = await state.c25.postgres.postgres.adminPool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM information_schema.tables
             WHERE table_schema = 'business' AND table_name = ANY($1::text[])`,
          [WARNING_TABLES],
        );
        return Number(result.rows[0]?.count ?? "0");
      };
      expect(await tableCount()).toBe(WARNING_TABLES.length);
      // 迁移必须可重复执行（IF NOT EXISTS + 审计外键守卫）。
      await warningMigration.up(runtime.db);
      expect(await tableCount()).toBe(WARNING_TABLES.length);
      await warningMigration.down(runtime.db);
      expect(await tableCount()).toBe(0);
      await warningMigration.up(runtime.db);
      expect(await tableCount()).toBe(WARNING_TABLES.length);
    } finally {
      await runtime.close();
    }
  }, 240_000);
});
