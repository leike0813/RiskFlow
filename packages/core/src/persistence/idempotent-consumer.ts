import type { DomainEventV1 } from "@riskflow/contracts/events";

import type { TransactionContextV1 } from "./transaction.js";
import type { ConsumerHandlerResultV1, ConsumerResultV1 } from "./schema.js";

export type IdempotentConsumerHandlerV1 = (
  context: TransactionContextV1,
  event: DomainEventV1,
) => Promise<ConsumerHandlerResultV1>;

export interface IdempotentConsumerV1 {
  consume(
    consumerName: string,
    event: DomainEventV1,
    handler: IdempotentConsumerHandlerV1,
  ): Promise<ConsumerResultV1>;
}
