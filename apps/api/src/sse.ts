import { type ServerResponse } from "node:http";

import {
  AuthorizationContextV1Schema,
  DomainEventRefV1Schema,
  ProjectionSubscriptionResultV1Schema,
  WorkflowRunRefV1Schema,
  type AuthorizationContextV1,
  type DomainEventRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";

import {
  HTTP_SCHEMA_VERSION_V1,
  HttpErrorV1Schema,
  HttpTransportError,
  type HttpFailureV1,
  SseDomainEventDataV1Schema,
} from "./http.js";
import { z } from "zod";

export const SSE_DOMAIN_EVENT_NAME_V1 = "domain-event-ref.v1" as const;
export const SSE_ERROR_EVENT_NAME_V1 = "error.v1" as const;

export const SsePolicyV1Schema = z.strictObject({
  pollIntervalMs: z.number().int().positive().max(60_000),
  heartbeatIntervalMs: z.number().int().positive().max(300_000),
  batchSize: z.number().int().positive().max(256),
  maxConnectionMs: z.number().int().positive().max(3_600_000),
  maxBufferedBytes: z
    .number()
    .int()
    .positive()
    .max(16 * 1024 * 1024),
});
export type SsePolicyV1 = z.infer<typeof SsePolicyV1Schema>;

export const DEFAULT_SSE_POLICY_V1: SsePolicyV1 = Object.freeze({
  pollIntervalMs: 1_000,
  heartbeatIntervalMs: 15_000,
  batchSize: 64,
  maxConnectionMs: 300_000,
  maxBufferedBytes: 1_048_576,
});

export const normalizeSsePolicy = (policy?: Partial<SsePolicyV1>): SsePolicyV1 =>
  SsePolicyV1Schema.parse({ ...DEFAULT_SSE_POLICY_V1, ...policy });

const frameBytes = (frame: string): number => Buffer.byteLength(frame, "utf8");

export const formatDomainEventFrame = (input: {
  readonly workflowRunRef: WorkflowRunRefV1;
  readonly domainEventRef: DomainEventRefV1;
  readonly maxBytes?: number;
}): string => {
  const workflowRunRef = WorkflowRunRefV1Schema.parse(input.workflowRunRef);
  const domainEventRef = DomainEventRefV1Schema.parse(input.domainEventRef);
  if (domainEventRef.eventId.includes("\r") || domainEventRef.eventId.includes("\n")) {
    throw new Error("event id contains a line break");
  }
  const data = SseDomainEventDataV1Schema.parse({
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    workflowRunRef,
    domainEventRef,
  });
  const frame = [
    `id: ${domainEventRef.eventId}`,
    `event: ${SSE_DOMAIN_EVENT_NAME_V1}`,
    `data: ${JSON.stringify(data)}`,
    "",
    "",
  ].join("\n");
  if (input.maxBytes !== undefined && frameBytes(frame) > input.maxBytes) {
    throw new Error("SSE frame exceeds configured bound");
  }
  return frame;
};

export const formatHeartbeatFrame = (): string => ": heartbeat\n\n";

export const formatErrorFrame = (error: unknown, maxBytes?: number): string => {
  const safeError = HttpErrorV1Schema.parse(error);
  const frame = [
    `event: ${SSE_ERROR_EVENT_NAME_V1}`,
    `data: ${JSON.stringify(safeError)}`,
    "",
    "",
  ].join("\n");
  if (maxBytes !== undefined && frameBytes(frame) > maxBytes) {
    throw new Error("SSE error frame exceeds configured bound");
  }
  return frame;
};

export type SseSubscriptionContextV1 = Readonly<{
  authorization: AuthorizationContextV1;
  workflowRunRef: WorkflowRunRefV1;
  afterEventId?: string;
}>;

export interface SseStreamInputV1 {
  readonly raw: ServerResponse;
  readonly signal?: AbortSignal;
  readonly workflowRunRef: WorkflowRunRefV1;
  readonly initialAfterEventId?: string;
  readonly policy: SsePolicyV1;
  readonly now?: () => Date;
  readonly authorize: () => Promise<AuthorizationContextV1>;
  readonly subscribe: (context: SseSubscriptionContextV1) => Promise<unknown>;
  readonly toError: (error: unknown) => HttpFailureV1;
  readonly open: () => void;
}

const isClosed = (raw: ServerResponse): boolean =>
  raw.destroyed || raw.writableEnded || raw.writableFinished;

const waitForSignal = async (signal: AbortSignal, milliseconds: number): Promise<boolean> => {
  if (signal.aborted) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(true), Math.max(0, milliseconds));
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = (): void => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const waitForDrain = async (
  raw: ServerResponse,
  signal: AbortSignal,
  milliseconds: number,
): Promise<boolean> => {
  if (signal.aborted || isClosed(raw)) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), Math.max(0, milliseconds));
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      raw.off("drain", onDrain);
      raw.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onDrain = (): void => finish(true);
    const onClose = (): void => finish(false);
    const onAbort = (): void => finish(false);
    raw.on("drain", onDrain);
    raw.on("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const writeFrame = async (
  raw: ServerResponse,
  signal: AbortSignal,
  frame: string,
  policy: SsePolicyV1,
  milliseconds: number,
): Promise<boolean> => {
  if (
    milliseconds <= 0 ||
    frameBytes(frame) > policy.maxBufferedBytes ||
    signal.aborted ||
    isClosed(raw)
  )
    return false;
  if (
    typeof raw.writableLength === "number" &&
    raw.writableLength + frameBytes(frame) > policy.maxBufferedBytes
  ) {
    return false;
  }
  const writable = raw.write(frame);
  if (writable) return true;
  if (typeof raw.writableLength === "number" && raw.writableLength > policy.maxBufferedBytes)
    return false;
  return waitForDrain(raw, signal, milliseconds);
};

const remainingMilliseconds = (deadline: number): number => Math.max(0, deadline - Date.now());

export const serveSse = async (input: SseStreamInputV1): Promise<void> => {
  const policy = SsePolicyV1Schema.parse(input.policy);
  const workflowRunRef = WorkflowRunRefV1Schema.parse(input.workflowRunRef);
  const localController = new AbortController();
  const signal = localController.signal;
  const onExternalAbort = (): void => localController.abort();
  const onClose = (): void => localController.abort();
  input.signal?.addEventListener("abort", onExternalAbort, { once: true });
  input.raw.on("close", onClose);
  const deadline = Date.now() + policy.maxConnectionMs;
  const awaitBounded = async <T>(operation: Promise<T>): Promise<T> => {
    const milliseconds = remainingMilliseconds(deadline);
    if (signal.aborted || milliseconds <= 0) {
      localController.abort();
      throw new Error("SSE connection deadline reached");
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        callback();
      };
      const timer = setTimeout(() => {
        localController.abort();
        finish(() => reject(new Error("SSE connection deadline reached")));
      }, milliseconds);
      const onAbort = (): void => finish(() => reject(new Error("SSE connection closed")));
      signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  };
  let cursor = input.initialAfterEventId;
  let opened = false;
  let lastActivityAt = Date.now();
  let firstBatch = true;
  const sentEventIds = new Set<string>();

  const write = async (frame: string): Promise<boolean> =>
    writeFrame(input.raw, signal, frame, policy, remainingMilliseconds(deadline));

  try {
    const firstAuthorization = AuthorizationContextV1Schema.parse(
      await awaitBounded(Promise.resolve().then(() => input.authorize())),
    );
    if (signal.aborted) return;
    input.open();
    opened = true;

    while (!signal.aborted && remainingMilliseconds(deadline) > 0) {
      const authorization = AuthorizationContextV1Schema.parse(
        firstBatch
          ? firstAuthorization
          : await awaitBounded(Promise.resolve().then(() => input.authorize())),
      );
      if (signal.aborted) break;
      const result = ProjectionSubscriptionResultV1Schema.parse(
        await awaitBounded(
          Promise.resolve().then(() =>
            input.subscribe({
              authorization,
              workflowRunRef,
              ...(cursor === undefined ? {} : { afterEventId: cursor }),
            }),
          ),
        ),
      );
      firstBatch = false;
      if (result.kind === "failed") throw result.error;
      if (result.kind !== "succeeded") throw new Error("SSE subscription did not succeed");
      if (result.result.eventRefs.length > policy.batchSize)
        throw new Error("SSE batch exceeds configured bound");

      let sentEvent = false;
      for (const eventRef of result.result.eventRefs) {
        if (eventRef.eventId === cursor || sentEventIds.has(eventRef.eventId)) continue;
        const frame = formatDomainEventFrame({
          workflowRunRef,
          domainEventRef: eventRef,
          maxBytes: policy.maxBufferedBytes,
        });
        if (!(await write(frame))) {
          localController.abort();
          break;
        }
        cursor = eventRef.eventId;
        sentEventIds.add(eventRef.eventId);
        while (sentEventIds.size > policy.batchSize * 2) {
          const oldest = sentEventIds.values().next().value;
          if (oldest === undefined) break;
          sentEventIds.delete(oldest);
        }
        sentEvent = true;
        lastActivityAt = Date.now();
      }
      if (signal.aborted) break;
      if (sentEvent) continue;

      const sinceActivity = Date.now() - lastActivityAt;
      const heartbeatIn = policy.heartbeatIntervalMs - sinceActivity;
      if (heartbeatIn <= 0) {
        if (!(await write(formatHeartbeatFrame()))) {
          localController.abort();
          break;
        }
        lastActivityAt = Date.now();
        continue;
      }
      if (
        !(await waitForSignal(
          signal,
          Math.min(policy.pollIntervalMs, heartbeatIn, remainingMilliseconds(deadline)),
        ))
      )
        break;
    }
  } catch (error) {
    if (!opened) throw new HttpTransportError(input.toError(error));
    if (!signal.aborted) {
      try {
        await write(formatErrorFrame(input.toError(error).error, policy.maxBufferedBytes));
      } catch {
        // A closed or back-pressured stream cannot carry an error frame.
      }
    }
  } finally {
    localController.abort();
    input.signal?.removeEventListener("abort", onExternalAbort);
    input.raw.off("close", onClose);
    if (!isClosed(input.raw)) input.raw.end();
  }
};
