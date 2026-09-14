import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import type { ConsumerResultV1, IdempotentConsumerV1 } from "@riskflow/core/persistence";
import type { WarningInAppNotificationWriterV1 } from "@riskflow/core/warning";

/** 固定消费者身份：同一预警事件在本消费者下最多形成一份同意图投递事实。 */
export const WARNING_IN_APP_NOTIFICATION_CONSUMER_V1 = "warning.in-app-notification.v1" as const;

export class WarningInAppNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarningInAppNotificationError";
  }
}

export interface WarningInAppNotificationRuntimeOptionsV1 {
  /** C03 PostgreSQL 幂等消费者：提供自有收据与事务绑定上下文。 */
  readonly consumer: IdempotentConsumerV1;
  /** C26 事务绑定投递写入器：只接受本 handler 传入的消费者事务上下文。 */
  readonly writer: WarningInAppNotificationWriterV1;
}

/**
 * 只在 `warning.warning-recorded.v1` 已可靠入库后消费其通知意图：
 * 严格解析事件、复用 C03 幂等消费者，并在消费者事务内追加应用内投递事实。
 * 投递失败使消费者事务回滚并留痕，已提交的预警、任务与意图不受影响。
 */
export const consumeWarningRecordedForInAppNotification = async (
  options: WarningInAppNotificationRuntimeOptionsV1,
  event: DomainEventV1,
): Promise<ConsumerResultV1> => {
  const parsed = DomainEventV1Schema.safeParse(event);
  if (!parsed.success) {
    throw new WarningInAppNotificationError("warning-recorded event is invalid");
  }
  if (parsed.data.eventType !== "warning.warning-recorded.v1") {
    throw new WarningInAppNotificationError("only warning.warning-recorded.v1 is consumed here");
  }
  return options.consumer.consume(
    WARNING_IN_APP_NOTIFICATION_CONSUMER_V1,
    parsed.data,
    async (context, consumedEvent) => {
      if (consumedEvent.eventType !== "warning.warning-recorded.v1") {
        throw new WarningInAppNotificationError("consumed event type changed");
      }
      await options.writer.deliverInAppNotifications(context, {
        projectId: consumedEvent.projectId,
        warningRecordRef: consumedEvent.payload.warningRecordRef,
        warningResponseTaskRef: consumedEvent.payload.warningResponseTaskRef,
        notificationIntentRefs: consumedEvent.payload.notificationIntentRefs,
      });
      return { resultRef: consumedEvent.payload.warningRecordRef };
    },
  );
};
