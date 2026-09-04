import { ContractReferenceV1Schema } from "@riskflow/contracts/ports";
import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import { HTTP_SCHEMA_VERSION_V1 } from "./constants.js";

export type HttpErrorCodeV1 =
  | "CONTRACT_INVALID"
  | "AUTHENTICATION_REQUIRED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "IDEMPOTENCY_CONFLICT"
  | "BUSINESS_BLOCKED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNSUPPORTED_CONTRACT"
  | "REQUEST_TOO_LARGE"
  | "TRANSIENT_FAILURE"
  | "TERMINAL_FAILURE";

export type SafeHttpErrorV1 = Readonly<{
  schemaVersion: typeof HTTP_SCHEMA_VERSION_V1;
  requestId: string;
  code: HttpErrorCodeV1;
  retryable: boolean;
  occurredAt: string;
  references: readonly ContractReferenceV1[];
  attempt?: number;
  retryAt?: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isDateString = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const safeErrorCode = (value: unknown): value is HttpErrorCodeV1 =>
  typeof value === "string" &&
  [
    "CONTRACT_INVALID",
    "AUTHENTICATION_REQUIRED",
    "PASSWORD_CHANGE_REQUIRED",
    "NOT_FOUND",
    "STALE_VERSION",
    "IDEMPOTENCY_CONFLICT",
    "BUSINESS_BLOCKED",
    "UNSUPPORTED_MEDIA_TYPE",
    "UNSUPPORTED_CONTRACT",
    "REQUEST_TOO_LARGE",
    "TRANSIENT_FAILURE",
    "TERMINAL_FAILURE",
  ].includes(value);

const requestIdFallback = (value: unknown): string =>
  isNonEmptyString(value) && !/[\r\n]/.test(value) ? value.trim().slice(0, 128) : "web-request";

export const makeSafeHttpError = (input?: {
  readonly requestId?: unknown;
  readonly code?: HttpErrorCodeV1;
  readonly retryable?: boolean;
  readonly occurredAt?: string;
  readonly references?: readonly ContractReferenceV1[];
  readonly attempt?: number;
  readonly retryAt?: string;
}): SafeHttpErrorV1 => {
  const occurredAt = isDateString(input?.occurredAt) ? input.occurredAt : new Date().toISOString();
  const references = (input?.references ?? []).slice(0, 16);
  const base = {
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    requestId: requestIdFallback(input?.requestId),
    code: input?.code ?? "TERMINAL_FAILURE",
    retryable: input?.retryable ?? false,
    occurredAt,
    references,
  } satisfies Omit<SafeHttpErrorV1, "attempt" | "retryAt">;
  const attempt = input?.attempt;
  const retryAt = input?.retryAt;
  if (
    typeof attempt === "number" &&
    Number.isSafeInteger(attempt) &&
    attempt > 0 &&
    isDateString(retryAt)
  )
    return Object.freeze({ ...base, attempt, retryAt });
  if (typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > 0)
    return Object.freeze({ ...base, attempt });
  if (isDateString(retryAt)) return Object.freeze({ ...base, retryAt });
  return Object.freeze(base);
};

export const decodeSafeHttpError = (
  value: unknown,
  fallbackRequestId = "web-request",
): SafeHttpErrorV1 => {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }
  }
  if (!isRecord(parsed)) return makeSafeHttpError({ requestId: fallbackRequestId });
  const validSchema = parsed.schemaVersion === HTTP_SCHEMA_VERSION_V1;
  const code = validSchema && safeErrorCode(parsed.code) ? parsed.code : "TERMINAL_FAILURE";
  const validPayload = validSchema && safeErrorCode(parsed.code);
  const references = Array.isArray(parsed.references)
    ? parsed.references
        .map((item) => {
          const result = ContractReferenceV1Schema.safeParse(item);
          return result.success ? result.data : undefined;
        })
        .filter((item): item is ContractReferenceV1 => item !== undefined)
    : [];
  return makeSafeHttpError({
    requestId: parsed.requestId ?? fallbackRequestId,
    code,
    retryable: validPayload && typeof parsed.retryable === "boolean" ? parsed.retryable : false,
    ...(validPayload && isDateString(parsed.occurredAt) ? { occurredAt: parsed.occurredAt } : {}),
    references: validPayload ? references : [],
    ...(validPayload && typeof parsed.attempt === "number" ? { attempt: parsed.attempt } : {}),
    ...(validPayload && isDateString(parsed.retryAt) ? { retryAt: parsed.retryAt } : {}),
  });
};

export { isDateString, isNonEmptyString, isRecord, requestIdFallback, safeErrorCode };
