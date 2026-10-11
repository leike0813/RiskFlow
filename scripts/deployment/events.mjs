/**
 * C37 D-21：Outbox 事件的闭合 dispatch 表。
 *
 * 12 个已知事件逐项登记：
 * - 有消费者的交给该消费者在其原事务内产生幂等回执后才 acknowledge；
 * - 无后台消费者的做**显式 no-background-consumer 登记**，事件仍留在耐久日志与 SSE，
 *   acknowledge 不删除任何事实；
 * - 未登记的事件一律失败并保持非就绪，绝不静默吞掉。
 *
 * 重投沿原 eventId/consumerName 身份，不重新生成业务事实或人工决定。
 */

/** 显式登记「没有后台消费者」的事件；ack 不得删除事件。 */
export const NO_BACKGROUND_CONSUMER = "no-background-consumer";

/** 有后台消费者的处理方式标识。 */
export const BACKGROUND_CONSUMER = "background-consumer";

/**
 * 闭合事件清单。键是 eventType，值声明该事件的投递语义。
 * 新增或遗漏事件都会在注册时被拒绝，保持清单与实现同源。
 */
export const CLOSED_OUTBOX_EVENT_TYPES_V1 = Object.freeze([
  "knowledge.identification-basis-published.v1",
  "warning.warning-recorded.v1",
  "review.review-resolved.v1",
  "engineering.inputs-ready.v1",
  "identification.risk-record-accepted.v1",
  "engineering.assessment-input-changed.v1",
  "knowledge.assessment-basis-published.v1",
  "assessment.recorded.v1",
  "warning.warning-acknowledged.v1",
  "warning.feedback-recorded.v1",
  "warning.calibration-suggestion-created.v1",
  "review.review-requested.v1",
]);

/** 每个事件对应的消费者名；稳定身份用于重投与幂等。 */
export const OUTBOX_CONSUMER_NAMES_V1 = Object.freeze({
  "knowledge.identification-basis-published.v1": "projection",
  "warning.warning-recorded.v1": "warning-notification",
  "review.review-resolved.v1": "identification-recovery",
  "engineering.inputs-ready.v1": "risk-flow",
  "identification.risk-record-accepted.v1": "risk-flow",
  "engineering.assessment-input-changed.v1": NO_BACKGROUND_CONSUMER,
  "knowledge.assessment-basis-published.v1": NO_BACKGROUND_CONSUMER,
  "assessment.recorded.v1": NO_BACKGROUND_CONSUMER,
  "warning.warning-acknowledged.v1": NO_BACKGROUND_CONSUMER,
  "warning.feedback-recorded.v1": NO_BACKGROUND_CONSUMER,
  "warning.calibration-suggestion-created.v1": NO_BACKGROUND_CONSUMER,
  "review.review-requested.v1": NO_BACKGROUND_CONSUMER,
});

export class UnknownOutboxEventError extends Error {
  constructor(eventType) {
    super(`unknown outbox event type: ${eventType}`);
    this.name = "UnknownOutboxEventError";
    this.eventType = eventType;
  }
}

export class ConsumerNotBoundError extends Error {
  constructor(eventType, consumerName) {
    super(`outbox consumer is not bound: ${consumerName} for ${eventType}`);
    this.name = "ConsumerNotBoundError";
    this.eventType = eventType;
    this.consumerName = consumerName;
  }
}

/** 事件的投递登记结果。 */
export const deliveryPlanV1 = (eventType) => {
  const consumerName = OUTBOX_CONSUMER_NAMES_V1[eventType];
  if (consumerName === undefined) throw new UnknownOutboxEventError(eventType);
  return Object.freeze({
    eventType,
    consumerName,
    hasBackgroundConsumer: consumerName !== NO_BACKGROUND_CONSUMER,
  });
};

/**
 * 事件 dispatch 注册表。
 *
 * `dispatch` 只在消费者成功返回耐久幂等回执后才 resolve `acknowledged`；
 * 显式无消费者的事件直接返回 `acknowledged`，并在结果里标明它没有后台处理。
 */
export class OutboxDispatchRegistryV1 {
  #consumers = new Map();

  /**
   * 登记后台消费者。消费者名必须与闭合清单一致，防止运行期悄悄换实现。
   */
  register(eventType, consumerName, handler) {
    const plan = deliveryPlanV1(eventType);
    if (!plan.hasBackgroundConsumer) {
      throw new TypeError(`${eventType} is explicitly registered without a background consumer`);
    }
    if (plan.consumerName !== consumerName) {
      throw new TypeError(
        `${eventType} must be consumed by ${plan.consumerName}, not ${consumerName}`,
      );
    }
    if (typeof handler !== "function") {
      throw new TypeError(`consumer ${consumerName} requires a handler function`);
    }
    if (this.#consumers.has(eventType)) {
      throw new TypeError(`consumer for ${eventType} is already registered`);
    }
    this.#consumers.set(eventType, { consumerName, handler });
    return this;
  }

  boundConsumers() {
    return [...this.#consumers.keys()].sort();
  }

  /** 每个事件只允许一次性调用；重复登记会覆盖，这里显式拒绝。 */
  registerAll(entries) {
    for (const [eventType, consumerName, handler] of entries) {
      this.register(eventType, consumerName, handler);
    }
    return this;
  }

  async dispatch(event, { signal } = {}) {
    const plan = deliveryPlanV1(event.eventType);
    if (!plan.hasBackgroundConsumer) {
      // 事件仍留在耐久日志与 SSE；ack 不删除任何事实。
      return Object.freeze({
        eventType: event.eventType,
        consumerName: plan.consumerName,
        status: "acknowledged",
        durableReceipt: null,
        backgroundConsumerAbsent: true,
      });
    }
    const consumer = this.#consumers.get(event.eventType);
    if (consumer === undefined) {
      throw new ConsumerNotBoundError(event.eventType, plan.consumerName);
    }
    const receipt = await consumer.handler(event, { signal });
    // 消费者未给出耐久回执时不得声称已处理。
    if (receipt === undefined || receipt === null) {
      return Object.freeze({
        eventType: event.eventType,
        consumerName: plan.consumerName,
        status: "failed",
        durableReceipt: null,
        backgroundConsumerAbsent: false,
      });
    }
    return Object.freeze({
      eventType: event.eventType,
      consumerName: plan.consumerName,
      status: "acknowledged",
      durableReceipt: receipt,
      backgroundConsumerAbsent: false,
    });
  }

  /**
   * 已声明存在后台消费者、但当前没有绑定的消费者名。
   * 宿主据此判定未就绪，而不是在运行期发现后静默吞掉事件。
   */
  missingConsumers() {
    // 按事件类型排序，保证就绪报告与测试断言稳定，不依赖清单声明顺序。
    return CLOSED_OUTBOX_EVENT_TYPES_V1.filter((eventType) => {
      const plan = deliveryPlanV1(eventType);
      return plan.hasBackgroundConsumer && !this.#consumers.has(eventType);
    }).sort();
  }

  assertReady() {
    const missing = this.missingConsumers();
    if (missing.length > 0) {
      throw new TypeError(`outbox dispatch is not ready: ${missing.join(", ")}`);
    }
    return this;
  }
}
