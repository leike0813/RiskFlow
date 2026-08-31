import { describe, expect, it } from "vitest";

import {
  AtomicCommandV1Schema,
  OutboxDeliveryPolicyV1Schema,
  PersistenceErrorV1Schema,
  canonicalJson,
  outboxBackoffDelayMs,
  sha256CanonicalJson,
} from "../src/persistence/index.js";

const policy = OutboxDeliveryPolicyV1Schema.parse({
  policyRef: { entityId: "outbox-policy", versionId: "v1" },
  batchSize: 10,
  leaseDurationMs: 10_000,
  baseDelayMs: 1_000,
  maxDelayMs: 5_000,
  maxAttempts: 3,
});

const sparse = new Array<unknown>(2);
sparse[1] = 1;
const invalidJsonValues: unknown[] = [
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  new Date(),
  new Map(),
  sparse,
];

describe("persistence protocol", () => {
  it("canonicalizes object keys but preserves array order", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(sha256CanonicalJson({ b: 2, a: 1 })).toBe(sha256CanonicalJson({ a: 1, b: 2 }));
    expect(sha256CanonicalJson(["a", "b"])).not.toBe(sha256CanonicalJson(["b", "a"]));
  });

  it.each(invalidJsonValues)("rejects non-JSON value %s", (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it("keeps DTO envelopes strict", () => {
    const command = {
      projectId: "project-1",
      commandKind: "fixture.write",
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
      payload: { value: 1 },
      actorRef: "actor-1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "auth-1", versionId: "v1" },
      },
    };
    expect(AtomicCommandV1Schema.safeParse(command).success).toBe(true);
    expect(AtomicCommandV1Schema.safeParse({ ...command, secret: "not allowed" }).success).toBe(
      false,
    );
  });

  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 5_000],
    [10, 5_000],
  ])("uses capped deterministic backoff for attempt %i", (attempt, expected) => {
    expect(outboxBackoffDelayMs(policy, attempt)).toBe(expected);
  });

  it("accepts only closed structured persistence errors", () => {
    const error = PersistenceErrorV1Schema.parse({
      code: "OUTBOX_LEASE_LOST",
      retryable: true,
      stage: "outbox.acknowledge",
      occurredAt: "2026-08-31T00:00:00Z",
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-1", versionId: "v1" },
      },
      contextRefs: [],
    });
    expect(error.code).toBe("OUTBOX_LEASE_LOST");
    expect(PersistenceErrorV1Schema.safeParse({ ...error, sql: "select password" }).success).toBe(
      false,
    );
  });
});
