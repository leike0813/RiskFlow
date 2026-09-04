import type { DomainEventRefV1, WorkflowRunRefV1 } from "@riskflow/contracts/ports";

import { decodeSafeHttpError, type SafeHttpErrorV1 } from "./errors.js";
import {
  HTTP_SCHEMA_VERSION_V1,
  SSE_DOMAIN_EVENT_NAME_V1,
  SSE_ERROR_EVENT_NAME_V1,
} from "./constants.js";

export type EventSourceEventV1 = Readonly<{ data?: unknown }>;

export type EventSourceLikeV1 = Readonly<{
  addEventListener: (type: string, listener: (event: EventSourceEventV1) => void) => void;
  removeEventListener: (type: string, listener: (event: EventSourceEventV1) => void) => void;
  close: () => void;
}>;

export type SseConnectionStateV1 = "connecting" | "open" | "recovering" | "closed" | "error";

export type C09SseEventDataV1 = Readonly<{
  schemaVersion: typeof HTTP_SCHEMA_VERSION_V1;
  workflowRunRef: WorkflowRunRefV1;
  domainEventRef: DomainEventRefV1;
}>;

export type C09RunSubscriptionInputV1 = Readonly<{
  projectId: string;
  workflowRunRef: WorkflowRunRefV1;
  onEventRef?: (eventRef: DomainEventRefV1) => void;
  onRefresh?: () => void;
  onState?: (state: SseConnectionStateV1) => void;
  onError?: (error: SafeHttpErrorV1) => void;
  eventSourceFactory?: (url: string) => EventSourceLikeV1;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}>;

export type C09RunSubscriptionHandleV1 = Readonly<{
  runId: string;
  url: string;
  close: () => void;
  getState: () => SseConnectionStateV1;
}>;

export type C09SseClientV1 = Readonly<{
  subscribe: (input: C09RunSubscriptionInputV1) => C09RunSubscriptionHandleV1;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isVersionReference = (value: unknown): value is { entityId: string; versionId: string } => {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  return nonEmpty(value.entityId) && nonEmpty(value.versionId);
};

const isWorkflowRunRef = (value: unknown): value is WorkflowRunRefV1 => {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.kind !== "workflow-run")
    return false;
  return isVersionReference(value.reference);
};

const isDomainEventRef = (value: unknown): value is DomainEventRefV1 =>
  isRecord(value) &&
  Object.keys(value).length === 3 &&
  value.kind === "domain-event" &&
  nonEmpty(value.eventId) &&
  value.eventVersion === 1;

const normalizeRunRef = (value: WorkflowRunRefV1): WorkflowRunRefV1 => ({
  kind: "workflow-run",
  reference: {
    entityId: value.reference.entityId.trim(),
    versionId: value.reference.versionId.trim(),
  },
});

const bytesToBinary = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
};

const binaryToBytes = (binary: string): Uint8Array => {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const base64UrlEncode = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const encoded = globalThis.btoa(bytesToBinary(bytes));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const base64UrlDecode = (value: string): string | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) return undefined;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - (padded.length % 4)) % 4;
  try {
    return new TextDecoder().decode(
      binaryToBytes(globalThis.atob(`${padded}${"=".repeat(padding)}`)),
    );
  } catch {
    return undefined;
  }
};

export const encodeCanonicalRunIdV1 = (value: WorkflowRunRefV1): string => {
  if (!isWorkflowRunRef(value)) throw new Error("invalid workflow run reference");
  const run = normalizeRunRef(value);
  return base64UrlEncode(JSON.stringify(run.reference));
};

export const decodeCanonicalRunIdV1 = (value: unknown): WorkflowRunRefV1 => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048)
    throw new Error("invalid workflow run id");
  const decoded = base64UrlDecode(value);
  if (decoded === undefined) throw new Error("invalid workflow run id");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("invalid workflow run id");
  }
  if (!isVersionReference(parsed)) throw new Error("invalid workflow run id");
  const run: WorkflowRunRefV1 = {
    kind: "workflow-run",
    reference: {
      entityId: parsed.entityId.trim(),
      versionId: parsed.versionId.trim(),
    },
  };
  if (encodeCanonicalRunIdV1(run) !== value) throw new Error("non-canonical workflow run id");
  return run;
};

export const encodeWorkflowRunIdV1 = encodeCanonicalRunIdV1;
export const decodeWorkflowRunIdV1 = decodeCanonicalRunIdV1;

export const decodeSseDomainEvent = (value: unknown): C09SseEventDataV1 | undefined => {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 3) return undefined;
  if (parsed.schemaVersion !== HTTP_SCHEMA_VERSION_V1 || !isWorkflowRunRef(parsed.workflowRunRef))
    return undefined;
  if (!isDomainEventRef(parsed.domainEventRef)) return undefined;
  return {
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    workflowRunRef: normalizeRunRef(parsed.workflowRunRef),
    domainEventRef: {
      kind: "domain-event",
      eventId: parsed.domainEventRef.eventId.trim(),
      eventVersion: 1,
    },
  };
};

const sameRun = (left: WorkflowRunRefV1, right: WorkflowRunRefV1): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const defaultEventSourceFactory = (url: string): EventSourceLikeV1 => {
  if (typeof globalThis.EventSource !== "function") throw new Error("EventSource is unavailable");
  return new globalThis.EventSource(url) as unknown as EventSourceLikeV1;
};

const defaultScheduleFrame = (callback: () => void): number => {
  if (typeof globalThis.requestAnimationFrame === "function")
    return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(callback, 0);
};

const defaultCancelFrame = (handle: number): void => {
  if (typeof globalThis.cancelAnimationFrame === "function")
    globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
};

const eventData = (event: EventSourceEventV1): unknown => event.data;

export const createRunSubscription = (
  input: C09RunSubscriptionInputV1,
): C09RunSubscriptionHandleV1 => {
  if (!nonEmpty(input.projectId) || input.projectId.includes("/") || input.projectId.includes("\\"))
    throw new Error("invalid project id");
  const workflowRunRef = normalizeRunRef(input.workflowRunRef);
  if (!isWorkflowRunRef(workflowRunRef)) throw new Error("invalid workflow run reference");
  const runId = encodeCanonicalRunIdV1(workflowRunRef);
  const url = `/api/v1/projects/${encodeURIComponent(input.projectId.trim())}/runs/${runId}/events`;
  const source = (input.eventSourceFactory ?? defaultEventSourceFactory)(url);
  const schedule = input.scheduleFrame ?? defaultScheduleFrame;
  const cancelSchedule = input.cancelFrame ?? defaultCancelFrame;
  let state: SseConnectionStateV1 = "connecting";
  let closed = false;
  let refreshHandle: number | undefined;
  const setState = (next: SseConnectionStateV1): void => {
    state = next;
    input.onState?.(next);
  };
  const queueRefresh = (): void => {
    if (closed || refreshHandle !== undefined) return;
    refreshHandle = schedule(() => {
      refreshHandle = undefined;
      if (!closed) input.onRefresh?.();
    });
  };
  const onOpen = (): void => setState("open");
  const onNativeError = (): void => {
    if (!closed) setState("recovering");
  };
  const onDomainEvent = (event: EventSourceEventV1): void => {
    if (closed) return;
    const data = decodeSseDomainEvent(eventData(event));
    if (data === undefined || !sameRun(data.workflowRunRef, workflowRunRef)) return;
    input.onEventRef?.(data.domainEventRef);
    queueRefresh();
  };
  const onErrorEvent = (event: EventSourceEventV1): void => {
    if (closed) return;
    const error = decodeSafeHttpError(eventData(event), "sse-client");
    input.onError?.(error);
    setState("error");
    close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (refreshHandle !== undefined) {
      cancelSchedule(refreshHandle);
      refreshHandle = undefined;
    }
    source.removeEventListener("open", onOpen);
    source.removeEventListener("error", onNativeError);
    source.removeEventListener(SSE_DOMAIN_EVENT_NAME_V1, onDomainEvent);
    source.removeEventListener(SSE_ERROR_EVENT_NAME_V1, onErrorEvent);
    source.close();
    if (state !== "error") setState("closed");
  };
  source.addEventListener("open", onOpen);
  source.addEventListener("error", onNativeError);
  source.addEventListener(SSE_DOMAIN_EVENT_NAME_V1, onDomainEvent);
  source.addEventListener(SSE_ERROR_EVENT_NAME_V1, onErrorEvent);
  return Object.freeze({ runId, url, close, getState: () => state });
};

export const createSseClient = (input?: {
  readonly eventSourceFactory?: (url: string) => EventSourceLikeV1;
  readonly scheduleFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}): C09SseClientV1 => {
  let active: C09RunSubscriptionHandleV1 | null = null;
  return Object.freeze({
    subscribe: (subscription: C09RunSubscriptionInputV1): C09RunSubscriptionHandleV1 => {
      active?.close();
      const handle = createRunSubscription({
        ...subscription,
        ...(input?.eventSourceFactory === undefined
          ? {}
          : { eventSourceFactory: input.eventSourceFactory }),
        ...(input?.scheduleFrame === undefined ? {} : { scheduleFrame: input.scheduleFrame }),
        ...(input?.cancelFrame === undefined ? {} : { cancelFrame: input.cancelFrame }),
      });
      const managed = Object.freeze({
        ...handle,
        close: () => {
          handle.close();
          if (active === managed) active = null;
        },
      });
      active = managed;
      return managed;
    },
  });
};
