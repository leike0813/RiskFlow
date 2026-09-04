import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  SsePolicyV1Schema,
  formatDomainEventFrame,
  formatHeartbeatFrame,
  serveSse,
} from "../src/sse.js";
import { invalidRequest, mapHttpError } from "../src/http.js";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";

const NOW = "2026-01-01T00:00:00.000Z";
const runRef = { kind: "workflow-run" as const, reference: { entityId: "run", versionId: "1" } };
const eventRef = (eventId: string) => ({
  kind: "domain-event" as const,
  eventId,
  eventVersion: 1 as const,
});
const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "context", versionId: "1" },
  },
  actorId: "actor",
  projectId: "project",
  grantedCapabilities: ["projection.subscribe" as const],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "policy", versionId: "1" },
  decidedAt: NOW,
  invocation: { kind: "human" as const },
} satisfies AuthorizationContextV1;

class FakeRaw extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableFinished = false;
  writableLength = 0;
  readonly chunks: string[] = [];
  onWrite?: () => void;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    this.onWrite?.();
    return true;
  }

  end(): void {
    this.writableEnded = true;
    this.writableFinished = true;
    this.emit("close");
  }
}

const raw = (controller: AbortController): ServerResponse => {
  const value = new FakeRaw();
  value.onWrite = () => controller.abort();
  return value as unknown as ServerResponse;
};

const policy = (overrides: Partial<Parameters<typeof SsePolicyV1Schema.parse>[0]> = {}) =>
  SsePolicyV1Schema.parse({
    pollIntervalMs: 1,
    heartbeatIntervalMs: 2,
    batchSize: 4,
    maxConnectionMs: 100,
    maxBufferedBytes: 1024,
    ...overrides,
  });

describe("C09 SSE shell", () => {
  it("uses the domain event id and emits only closed references", () => {
    const frame = formatDomainEventFrame({
      workflowRunRef: runRef,
      domainEventRef: eventRef("event-1"),
    });
    expect(frame).toContain("id: event-1\n");
    expect(frame).toContain("event: domain-event-ref.v1\n");
    expect(frame).toContain('"workflowRunRef"');
    expect(frame).not.toContain("payload");
    expect(formatHeartbeatFrame()).toBe(": heartbeat\n\n");
  });

  it("passes the durable resume cursor and stops after client abort", async () => {
    const controller = new AbortController();
    const output = raw(controller) as unknown as FakeRaw;
    const cursors: Array<string | undefined> = [];
    await serveSse({
      raw: output as unknown as ServerResponse,
      signal: controller.signal,
      workflowRunRef: runRef,
      initialAfterEventId: "event-0",
      policy: policy(),
      authorize: async () => authorization,
      subscribe: async (context) => {
        cursors.push(context.afterEventId);
        return { kind: "succeeded", result: { eventRefs: [eventRef("event-1")] } };
      },
      toError: (error) => mapHttpError({ error, requestId: "request", now: new Date(NOW) }),
      open: () => undefined,
    });
    expect(cursors).toEqual(["event-0"]);
    expect(output.chunks.join("")).toContain("id: event-1");
    expect(output.writableEnded).toBe(true);
  });

  it("sends a comment heartbeat without advancing the cursor", async () => {
    const controller = new AbortController();
    const output = raw(controller) as unknown as FakeRaw;
    let subscribeCalls = 0;
    await serveSse({
      raw: output as unknown as ServerResponse,
      signal: controller.signal,
      workflowRunRef: runRef,
      policy: policy({ heartbeatIntervalMs: 1 }),
      authorize: async () => authorization,
      subscribe: async () => {
        subscribeCalls += 1;
        return { kind: "succeeded", result: { eventRefs: [] } };
      },
      toError: (error) => mapHttpError({ error, requestId: "request", now: new Date(NOW) }),
      open: () => undefined,
    });
    expect(output.chunks).toContain(": heartbeat\n\n");
    expect(subscribeCalls).toBeGreaterThan(0);
    expect(output.chunks.join("")).not.toContain("id:");
  });

  it("maps a post-header subscription failure to a safe error frame", async () => {
    const controller = new AbortController();
    const output = raw(controller) as unknown as FakeRaw;
    await serveSse({
      raw: output as unknown as ServerResponse,
      signal: controller.signal,
      workflowRunRef: runRef,
      policy: policy(),
      authorize: async () => authorization,
      subscribe: async () => ({
        kind: "failed",
        error: {
          stageCode: "projection",
          occurredAt: NOW,
          causalRunId: "run",
          code: "TRANSIENT_FAILURE",
          category: "technical",
          retryable: true,
          attempt: 1,
          retryPolicyRef: { entityId: "retry", versionId: "1" },
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "diag", versionId: "1" },
          },
        },
      }),
      toError: (error) => mapHttpError({ error, requestId: "request", now: new Date(NOW) }),
      open: () => undefined,
    });
    const body = output.chunks.join("");
    expect(body).toContain("event: error.v1");
    expect(body).toContain('"code":"TRANSIENT_FAILURE"');
    expect(body).not.toContain("stageCode");
    expect(body).not.toContain("id:");
    expect(body).not.toContain("stack");
    expect(invalidRequest("request", new Date(NOW)).error.code).toBe("CONTRACT_INVALID");
  });
});
