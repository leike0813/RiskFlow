import { describe, expect, it } from "vitest";

import type { DomainEventRefV1, WorkflowRunRefV1 } from "@riskflow/contracts/ports";

import { makeSafeHttpError } from "../src/api/http.js";
import {
  createRunSubscription,
  createSseClient,
  decodeCanonicalRunIdV1,
  encodeCanonicalRunIdV1,
  type EventSourceEventV1,
  type EventSourceLikeV1,
} from "../src/api/sse.js";
import { SSE_DOMAIN_EVENT_NAME_V1, SSE_ERROR_EVENT_NAME_V1 } from "../src/api/constants.js";

const run: WorkflowRunRefV1 = {
  kind: "workflow-run",
  reference: { entityId: "运行/一", versionId: "v1" },
};
const otherRun: WorkflowRunRefV1 = {
  kind: "workflow-run",
  reference: { entityId: "run-2", versionId: "v1" },
};

const event = (eventId: string, workflowRunRef = run): EventSourceEventV1 => ({
  data: JSON.stringify({
    schemaVersion: "1",
    workflowRunRef,
    domainEventRef: { kind: "domain-event", eventId, eventVersion: 1 },
  }),
});

class FakeEventSource implements EventSourceLikeV1 {
  readonly listeners = new Map<string, Set<(event: EventSourceEventV1) => void>>();
  closeCalls = 0;

  addEventListener(type: string, listener: (event: EventSourceEventV1) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: EventSourceEventV1) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closeCalls += 1;
  }

  emit(type: string, value: EventSourceEventV1 = {}): void {
    this.listeners.get(type)?.forEach((listener) => listener(value));
  }
}

const eventRef = (eventId: string): DomainEventRefV1 => ({
  kind: "domain-event",
  eventId,
  eventVersion: 1,
});

describe("C10 C09 SSE 适配", () => {
  it("round-trips the canonical run id without padding or private cursor", () => {
    const encoded = encodeCanonicalRunIdV1(run);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("/");
    expect(decodeCanonicalRunIdV1(encoded)).toEqual(run);
    expect(() => decodeCanonicalRunIdV1(`${encoded}=`)).toThrow();
  });

  it("coalesces same-frame event references and terminates on safe error", () => {
    const source = new FakeEventSource();
    const scheduled: Array<() => void> = [];
    const refs: DomainEventRefV1[] = [];
    const refreshes: number[] = [];
    const errors: string[] = [];
    const states: string[] = [];
    const handle = createRunSubscription({
      projectId: "project-1",
      workflowRunRef: run,
      eventSourceFactory: () => source,
      scheduleFrame: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelFrame: () => undefined,
      onEventRef: (value) => refs.push(value),
      onRefresh: () => refreshes.push(1),
      onError: (error) => errors.push(error.code),
      onState: (state) => states.push(state),
    });
    expect(handle.url).toBe(`/api/v1/projects/project-1/runs/${handle.runId}/events`);
    expect(handle.url).not.toContain("?");
    source.emit(SSE_DOMAIN_EVENT_NAME_V1, event("event-1"));
    source.emit(SSE_DOMAIN_EVENT_NAME_V1, event("event-2"));
    source.emit(SSE_DOMAIN_EVENT_NAME_V1, event("ignored", otherRun));
    expect(refs).toEqual([eventRef("event-1"), eventRef("event-2")]);
    expect(refreshes).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(refreshes).toHaveLength(1);

    source.emit("error");
    expect(handle.getState()).toBe("recovering");
    source.emit("open");
    expect(handle.getState()).toBe("open");
    const safeError = makeSafeHttpError({ code: "AUTHENTICATION_REQUIRED" });
    source.emit(SSE_ERROR_EVENT_NAME_V1, { data: JSON.stringify(safeError) });
    expect(errors).toEqual(["AUTHENTICATION_REQUIRED"]);
    expect(handle.getState()).toBe("error");
    expect(source.closeCalls).toBe(1);
    expect(states).toContain("recovering");
    handle.close();
    expect(source.closeCalls).toBe(1);
  });

  it("keeps at most one browser EventSource subscription", () => {
    const sources: FakeEventSource[] = [];
    const client = createSseClient({
      eventSourceFactory: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
    });
    const first = client.subscribe({ projectId: "project-1", workflowRunRef: run });
    const second = client.subscribe({ projectId: "project-1", workflowRunRef: otherRun });
    expect(first.runId).not.toBe(second.runId);
    expect(sources[0]?.closeCalls).toBe(1);
    second.close();
    expect(sources[1]?.closeCalls).toBe(1);

    const sameRunClient = createSseClient({
      eventSourceFactory: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
    });
    const sameFirst = sameRunClient.subscribe({ projectId: "project-1", workflowRunRef: run });
    const sameSecond = sameRunClient.subscribe({ projectId: "project-1", workflowRunRef: run });
    sameFirst.close();
    const sameThird = sameRunClient.subscribe({ projectId: "project-1", workflowRunRef: otherRun });
    expect(sameSecond.runId).toBe(sameFirst.runId);
    expect(sources[3]?.closeCalls).toBe(1);
    sameThird.close();
  });
});
