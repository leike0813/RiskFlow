import type {
  OutboxAcknowledgeV1,
  OutboxClaimBatchRequestV1,
  OutboxClaimBatchResultV1,
  OutboxFailureV1,
  OutboxOperationResultV1,
  OutboxDeliveryPolicyV1,
} from "./schema.js";

export interface OutboxV1 {
  claimBatch(request: OutboxClaimBatchRequestV1): Promise<OutboxClaimBatchResultV1>;
  acknowledge(request: OutboxAcknowledgeV1): Promise<OutboxOperationResultV1>;
  recordFailure(request: OutboxFailureV1): Promise<OutboxOperationResultV1>;
}

export const outboxBackoffDelayMs = (
  policy: OutboxDeliveryPolicyV1,
  attemptCount: number,
): number => {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError("attemptCount must be a positive integer");
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptCount - 1));
};

export const calculateOutboxBackoffMs = outboxBackoffDelayMs;
