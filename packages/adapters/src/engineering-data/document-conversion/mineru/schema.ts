import { z } from "@riskflow/core/model";

import { VersionReferenceSchema } from "@riskflow/contracts/common";

const positiveSafeInteger = z.number().int().positive().safe();
const ratio = z.number().finite().min(0).max(1);
export const MINERU_OFFICIAL_TRANSFER_ORIGINS = [
  "https://mineru.net",
  "https://mineru.oss-cn-shanghai.aliyuncs.com",
  "https://cdn-mineru.openxlab.org.cn",
] as const;

const origin = z
  .string()
  .url()
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        (url.pathname !== "" && url.pathname !== "/")
      ) {
        context.addIssue({ code: "custom", message: "URL must be an HTTP origin" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "URL must be a valid origin" });
    }
  });

const privateHttpHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".intra")
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (ipv4 !== null) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) return false;
    const [first, second] = octets as [number, number, number, number];
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (!host.includes(":")) return false;
  if (host.includes(".")) return false;
  let groups: string[];
  try {
    const canonical = new URL(`http://[${host}]`).hostname.slice(1, -1);
    if (canonical !== host) return privateHttpHost(canonical);
    const sides = host.split("::");
    if (sides.length > 2) return false;
    const left = sides[0] === "" ? [] : sides[0]!.split(":");
    const right = sides.length === 1 || sides[1] === "" ? [] : sides[1]!.split(":");
    if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) return false;
    if (sides.length === 1 && left.length !== 8) return false;
    if (sides.length === 2 && left.length + right.length >= 8) return false;
    groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  } catch {
    return false;
  }
  const first = Number.parseInt(groups[0]!, 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (groups.slice(0, 7).every((group) => group === "0") && groups[7] === "1")
  );
};

export const MineruQualityPolicyV1Schema = z
  .strictObject({
    minNonEmptyPageRatio: ratio,
    minKeyFieldCoverage: ratio,
    keyFields: z.array(z.string().trim().min(1).max(200)).max(128),
  })
  .superRefine((policy, context) => {
    if (policy.minKeyFieldCoverage > 0 && policy.keyFields.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["keyFields"],
        message: "key-field coverage requires a key-field checklist",
      });
    }
  });

export const MineruConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    deploymentRef: VersionReferenceSchema,
    qualityPolicyRef: VersionReferenceSchema,
    resourceAllocationRef: VersionReferenceSchema,
    protocol: z.enum(["official-v4", "self-hosted-v1"]),
    endpoint: origin,
    credentialRef: z.string().trim().min(1).max(256).nullable(),
    allowedTransferOrigins: z.array(origin).min(1).max(32),
    requestTimeoutMs: positiveSafeInteger,
    pollIntervalMs: positiveSafeInteger,
    maxPolls: positiveSafeInteger,
    maxConcurrentRequests: positiveSafeInteger,
    maxResponseBytes: positiveSafeInteger,
    qualityPolicy: MineruQualityPolicyV1Schema,
  })
  .superRefine((config, context) => {
    const endpoint = new URL(config.endpoint);
    const origins = config.allowedTransferOrigins.map((value) => new URL(value).origin);
    if (new Set(origins).size !== origins.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedTransferOrigins"],
        message: "origins must be unique",
      });
    }
    if (!origins.includes(endpoint.origin)) {
      context.addIssue({
        code: "custom",
        path: ["allowedTransferOrigins"],
        message: "endpoint origin must be allowed",
      });
    }
    if (config.protocol === "official-v4") {
      if (endpoint.origin !== "https://mineru.net") {
        context.addIssue({
          code: "custom",
          path: ["endpoint"],
          message: "official v4 endpoint must be https://mineru.net",
        });
      }
      if (config.credentialRef === null) {
        context.addIssue({
          code: "custom",
          path: ["credentialRef"],
          message: "official v4 requires a credential reference",
        });
      }
      if (
        origins.some(
          (value) =>
            !MINERU_OFFICIAL_TRANSFER_ORIGINS.includes(
              value as (typeof MINERU_OFFICIAL_TRANSFER_ORIGINS)[number],
            ),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["allowedTransferOrigins"],
          message: "official transfer origins must be MinerU cloud origins",
        });
      }
    } else {
      if (config.credentialRef !== null && config.credentialRef.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["credentialRef"],
          message: "credential reference cannot be empty",
        });
      }
      if (endpoint.protocol !== "https:" && !privateHttpHost(endpoint.hostname)) {
        context.addIssue({
          code: "custom",
          path: ["endpoint"],
          message: "plain HTTP is limited to private self-hosted origins",
        });
      }
    }
  });

export type MineruConfigV1 = z.infer<typeof MineruConfigV1Schema>;

export const MINERU_ERROR_CODES_V1 = {
  inputInvalid: { code: "MINERU_INPUT_INVALID", stage: "input", retryable: false },
  deploymentMismatch: { code: "MINERU_DEPLOYMENT_MISMATCH", stage: "deployment", retryable: false },
  mediaTypeUnsupported: { code: "MINERU_MEDIA_TYPE_UNSUPPORTED", stage: "input", retryable: false },
  aborted: { code: "MINERU_ABORTED", stage: "cancel", retryable: false },
  timeout: { code: "MINERU_TIMEOUT", stage: "service", retryable: true },
  pollBudgetExhausted: { code: "MINERU_POLL_BUDGET_EXHAUSTED", stage: "service", retryable: false },
  concurrencyLimit: { code: "MINERU_CONCURRENCY_LIMIT", stage: "service", retryable: true },
  rateLimited: { code: "MINERU_RATE_LIMITED", stage: "service", retryable: true },
  unavailable: { code: "MINERU_SERVICE_UNAVAILABLE", stage: "service", retryable: true },
  httpFailure: { code: "MINERU_HTTP_FAILURE", stage: "service", retryable: false },
  transferOriginRejected: {
    code: "MINERU_TRANSFER_ORIGIN_REJECTED",
    stage: "transfer",
    retryable: false,
  },
  responseLimitExceeded: {
    code: "MINERU_RESPONSE_LIMIT_EXCEEDED",
    stage: "response",
    retryable: false,
  },
  protocolInvalid: { code: "MINERU_PROTOCOL_INVALID", stage: "protocol", retryable: false },
  taskLost: { code: "MINERU_TASK_LOST", stage: "task", retryable: false },
  taskPartial: { code: "MINERU_TASK_PARTIAL", stage: "task", retryable: false },
  taskFailed: { code: "MINERU_TASK_FAILED", stage: "task", retryable: false },
  artifactPersistenceFailed: {
    code: "MINERU_ARTIFACT_PERSISTENCE_FAILED",
    stage: "artifact",
    retryable: true,
  },
  middleInvalid: { code: "MINERU_MIDDLE_INVALID", stage: "normalize", retryable: false },
} as const;

export type MineruErrorCodeV1 =
  (typeof MINERU_ERROR_CODES_V1)[keyof typeof MINERU_ERROR_CODES_V1]["code"];
