import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WarningInAppNotificationWriterV1 } from "@riskflow/core/warning";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";

import {
  WARNING_IN_APP_NOTIFICATION_CONSUMER_V1,
  consumeWarningRecordedForInAppNotification,
} from "../../src/warning/index.js";
import {
  startWarningLifecycleFixture,
  type WarningLifecyclePostgresFixtureV1,
} from "../../../../packages/adapters/test/warning/fixture.js";

/** 让首次投递真实失败一次，用于证明投递失败不回滚预警并可重试。 */
const failingOnce = (
  writer: WarningInAppNotificationWriterV1,
): WarningInAppNotificationWriterV1 => {
  let failed = false;
  return {
    async deliverInAppNotifications(context, input) {
      if (!failed) {
        failed = true;
        throw new Error("in-app delivery unavailable once");
      }
      return writer.deliverInAppNotifications(context, input);
    },
  };
};

describe("C26 应用内通知投递", () => {
  let fixture: WarningLifecyclePostgresFixtureV1 | undefined;

  beforeAll(async () => {
    fixture = await startWarningLifecycleFixture();
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 120_000);

  const openedWarningEvents = async (
    state: WarningLifecyclePostgresFixtureV1,
    suffix: string,
  ): Promise<{ readonly commandId: string; readonly events: readonly DomainEventV1[] }> => {
    const assessment = await state.assess({ suffix });
    const commandId = `c26-worker-open-${suffix}`;
    const opened = await state.adapter.open(
      await state.openCommand({ commandId, assessmentRecordRef: assessment.assessmentRecordRef }),
    );
    expect(opened.kind).toBe("succeeded");
    const events = (await state.events("warning.warning-recorded.v1")).filter(
      (event) => event.producerCommandId === commandId,
    );
    expect(events).toHaveLength(assessment.triggerTypes.length);
    return { commandId, events };
  };

  it("预警提交后按精确意图逐条投递应用内通知并记录消费者收据", async () => {
    const state = fixture!;
    const { events } = await openedWarningEvents(state, "deliver");
    const notificationsBefore = await state.countRows("business.in_app_notifications");
    let delivered = 0;
    for (const event of events) {
      const result = await consumeWarningRecordedForInAppNotification(
        { consumer: state.consumer, writer: state.adapter },
        event,
      );
      expect(result.replayed).toBe(false);
      if (event.eventType === "warning.warning-recorded.v1") {
        expect(result.resultRef).toEqual(event.payload.warningRecordRef);
        delivered += event.payload.notificationIntentRefs.length;
        const receipt = await state.consumerReceipt(
          WARNING_IN_APP_NOTIFICATION_CONSUMER_V1,
          event.eventId,
        );
        expect(receipt?.status).toBe("completed");
        expect(receipt?.resultRef).toEqual(event.payload.warningRecordRef);
      }
    }
    expect(delivered).toBeGreaterThan(0);
    expect(await state.countRows("business.in_app_notifications")).toBe(
      notificationsBefore + delivered,
    );
    const firstEvent = events[0]!;
    if (firstEvent.eventType !== "warning.warning-recorded.v1") return;
    const firstIntentRows = await state.intentRows(
      firstEvent.payload.warningRecordRef.reference.entityId,
    );
    const deliveredRows = await state.notificationRows(
      firstIntentRows.map((intent) => intent.intentId),
    );
    expect(deliveredRows.map((row) => row.recipientActorId).sort()).toEqual(
      firstIntentRows.map((intent) => intent.recipientActorId).sort(),
    );
  }, 300_000);

  it("重复消费同一事件只保留一份投递事实", async () => {
    const state = fixture!;
    const { events } = await openedWarningEvents(state, "replay");
    const event = events[0]!;
    await consumeWarningRecordedForInAppNotification(
      { consumer: state.consumer, writer: state.adapter },
      event,
    );
    const notifications = await state.countRows("business.in_app_notifications");
    const replay = await consumeWarningRecordedForInAppNotification(
      { consumer: state.consumer, writer: state.adapter },
      event,
    );
    expect(replay.replayed).toBe(true);
    if (event.eventType === "warning.warning-recorded.v1") {
      expect(replay.resultRef).toEqual(event.payload.warningRecordRef);
    }
    expect(await state.countRows("business.in_app_notifications")).toBe(notifications);
    const receipt = await state.consumerReceipt(
      WARNING_IN_APP_NOTIFICATION_CONSUMER_V1,
      event.eventId,
    );
    expect(receipt?.status).toBe("completed");
    expect(receipt?.attemptCount).toBe(1);
  }, 300_000);

  it("投递失败不回滚预警事实，消费者记录失败且重试只落一份通知", async () => {
    const state = fixture!;
    const { events } = await openedWarningEvents(state, "failure");
    const event = events[0]!;
    const counts = {
      warnings: await state.countRows("business.warning_records"),
      tasks: await state.countRows("business.warning_response_tasks"),
      intents: await state.countRows("business.notification_intents"),
      notifications: await state.countRows("business.in_app_notifications"),
      openReceipts: await state.countReceipts("warning-response.open"),
    };
    await expect(
      consumeWarningRecordedForInAppNotification(
        { consumer: state.consumer, writer: failingOnce(state.adapter) },
        event,
      ),
    ).rejects.toThrow();
    expect(
      await state.consumerReceipt(WARNING_IN_APP_NOTIFICATION_CONSUMER_V1, event.eventId),
    ).toMatchObject({ status: "pending", attemptCount: 1 });
    // 已提交的预警、任务、意图与打开命令回执保持不变；不伪造送达。
    expect(await state.countRows("business.warning_records")).toBe(counts.warnings);
    expect(await state.countRows("business.warning_response_tasks")).toBe(counts.tasks);
    expect(await state.countRows("business.notification_intents")).toBe(counts.intents);
    expect(await state.countRows("business.in_app_notifications")).toBe(counts.notifications);
    expect(await state.countReceipts("warning-response.open")).toBe(counts.openReceipts);

    const retried = await consumeWarningRecordedForInAppNotification(
      { consumer: state.consumer, writer: state.adapter },
      event,
    );
    expect(retried.replayed).toBe(false);
    const expected =
      event.eventType === "warning.warning-recorded.v1"
        ? event.payload.notificationIntentRefs.length
        : 0;
    expect(await state.countRows("business.in_app_notifications")).toBe(
      counts.notifications + expected,
    );
    expect(
      (await state.consumerReceipt(WARNING_IN_APP_NOTIFICATION_CONSUMER_V1, event.eventId))?.status,
    ).toBe("completed");
  }, 300_000);

  it("非预警事件与不匹配意图都失败闭合且不写投递事实", async () => {
    const state = fixture!;
    const { events } = await openedWarningEvents(state, "mismatch");
    const other = await openedWarningEvents(state, "mismatch-other");
    const event = events[0]!;
    const otherEvent = other.events[0]!;
    const notifications = await state.countRows("business.in_app_notifications");

    const assessmentEvents = await state.events("assessment.recorded.v1");
    const foreignEvent = assessmentEvents[0]!;
    await expect(
      consumeWarningRecordedForInAppNotification(
        { consumer: state.consumer, writer: state.adapter },
        foreignEvent,
      ),
    ).rejects.toThrow();
    expect(
      await state.consumerReceipt(WARNING_IN_APP_NOTIFICATION_CONSUMER_V1, foreignEvent.eventId),
    ).toBeUndefined();

    if (
      event.eventType !== "warning.warning-recorded.v1" ||
      otherEvent.eventType !== "warning.warning-recorded.v1"
    ) {
      return;
    }
    const tampered = DomainEventV1Schema.parse({
      ...event,
      payload: {
        ...event.payload,
        notificationIntentRefs: otherEvent.payload.notificationIntentRefs,
      },
    });
    await expect(
      consumeWarningRecordedForInAppNotification(
        { consumer: state.consumer, writer: state.adapter },
        tampered,
      ),
    ).rejects.toThrow();
    expect(await state.countRows("business.in_app_notifications")).toBe(notifications);
    expect(
      (await state.consumerReceipt(WARNING_IN_APP_NOTIFICATION_CONSUMER_V1, tampered.eventId))
        ?.status,
    ).toBe("pending");
  }, 300_000);
});
