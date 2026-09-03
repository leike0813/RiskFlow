import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { BinaryLike } from "node:crypto";

import { PasswordV1Schema } from "@riskflow/core/access";

export const PASSWORD_POLICY_V1 = Object.freeze({
  policyVersion: "password-policy/v1",
  algorithm: "scrypt",
  cost: 131_072,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 268_435_456,
  maxConcurrent: 4,
} as const);

export const SESSION_TOKEN_POLICY_V1 = Object.freeze({
  version: "session-token/v1",
  prefix: "v1",
  sessionIdBytes: 16,
  nonceBytes: 16,
  macBytes: 32,
} as const);

export type RandomBytes = (size: number) => Uint8Array;

const realRandomBytes: RandomBytes = (size) => nodeRandomBytes(size);

interface PendingScrypt {
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

let activeScryptJobs = 0;
const pendingScryptJobs: PendingScrypt[] = [];

const pumpScrypt = (): void => {
  while (activeScryptJobs < PASSWORD_POLICY_V1.maxConcurrent) {
    const pending = pendingScryptJobs.shift();
    if (pending === undefined) return;
    activeScryptJobs += 1;
    void pending
      .run()
      .then(pending.resolve, pending.reject)
      .finally(() => {
        activeScryptJobs -= 1;
        pumpScrypt();
      });
  }
};

const limitedScrypt = <T>(run: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    pendingScryptJobs.push({
      run,
      resolve: (value) => resolve(value as T),
      reject,
    });
    pumpScrypt();
  });

export const activePasswordDerivations = (): number => activeScryptJobs;

export const validatePassword = (password: string): void => {
  const parsed = PasswordV1Schema.safeParse(password);
  if (!parsed.success) throw new TypeError("password does not satisfy password-policy/v1");
};

export interface PasswordCredentialV1 {
  readonly algorithm: "scrypt";
  readonly policyVersion: "password-policy/v1";
  readonly cost: 131_072;
  readonly blockSize: 8;
  readonly parallelization: 1;
  readonly keyLength: 32;
  readonly salt: Buffer;
  readonly derivedKey: Buffer;
}

const scryptAsync = (password: BinaryLike, salt: BinaryLike): Promise<Buffer> =>
  limitedScrypt(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        nodeScrypt(
          password,
          salt,
          PASSWORD_POLICY_V1.keyLength,
          {
            N: PASSWORD_POLICY_V1.cost,
            r: PASSWORD_POLICY_V1.blockSize,
            p: PASSWORD_POLICY_V1.parallelization,
            maxmem: PASSWORD_POLICY_V1.maxmem,
          },
          (error, derivedKey) => {
            if (error !== null) reject(error);
            else resolve(derivedKey);
          },
        );
      }),
  );

export const derivePassword = async (
  password: string,
  salt?: Uint8Array,
  randomBytes: RandomBytes = realRandomBytes,
): Promise<PasswordCredentialV1> => {
  validatePassword(password);
  const actualSalt = Buffer.from(salt ?? randomBytes(PASSWORD_POLICY_V1.saltLength));
  if (actualSalt.length !== PASSWORD_POLICY_V1.saltLength) {
    throw new TypeError("scrypt salt must be 16 bytes");
  }
  const derivedKey = await scryptAsync(password, actualSalt);
  return {
    algorithm: "scrypt",
    policyVersion: "password-policy/v1",
    cost: PASSWORD_POLICY_V1.cost,
    blockSize: PASSWORD_POLICY_V1.blockSize,
    parallelization: PASSWORD_POLICY_V1.parallelization,
    keyLength: PASSWORD_POLICY_V1.keyLength,
    salt: actualSalt,
    derivedKey,
  };
};

export const verifyPassword = async (
  password: string,
  credential: Pick<PasswordCredentialV1, "salt" | "derivedKey">,
): Promise<boolean> => {
  const derived = await scryptAsync(password, credential.salt);
  if (derived.length !== credential.derivedKey.length) return false;
  return timingSafeEqual(derived, credential.derivedKey);
};

export const DUMMY_PASSWORD = "riskflow-dummy-password-v1";

export const makeDummyCredential = async (
  randomBytes: RandomBytes = realRandomBytes,
): Promise<PasswordCredentialV1> => derivePassword(DUMMY_PASSWORD, undefined, randomBytes);

const base64Url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");
const fromBase64Url = (value: string): Buffer | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return undefined;
  }
};

export interface SessionTokenKeyV1 {
  readonly keyVersion: string;
  readonly hmacKey: Uint8Array;
}

export interface SessionTokenPartsV1 {
  readonly sessionId: Buffer;
  readonly nonce: Buffer;
}

const assertTokenKey = ({ keyVersion, hmacKey }: SessionTokenKeyV1): void => {
  if (
    typeof keyVersion !== "string" ||
    keyVersion.length === 0 ||
    !(hmacKey instanceof Uint8Array) ||
    hmacKey.byteLength < 32
  ) {
    throw new TypeError("session HMAC key requires a non-empty version and 32 bytes");
  }
};

const tokenMac = (parts: SessionTokenPartsV1, key: Uint8Array): Buffer =>
  createHmac("sha256", key)
    .update(Buffer.from("riskflow-session-v1\0", "utf8"))
    .update(parts.sessionId)
    .update(Buffer.from("\0", "utf8"))
    .update(parts.nonce)
    .digest();

export const encodeSessionToken = (parts: SessionTokenPartsV1, key: SessionTokenKeyV1): string => {
  assertTokenKey(key);
  if (
    parts.sessionId.length !== SESSION_TOKEN_POLICY_V1.sessionIdBytes ||
    parts.nonce.length !== SESSION_TOKEN_POLICY_V1.nonceBytes
  ) {
    throw new TypeError("session token identifiers must be 128-bit values");
  }
  return [
    SESSION_TOKEN_POLICY_V1.prefix,
    base64Url(parts.sessionId),
    base64Url(parts.nonce),
    base64Url(tokenMac(parts, key.hmacKey)),
  ].join(".");
};

export const createSessionToken = (
  key: SessionTokenKeyV1,
  randomBytes: RandomBytes = realRandomBytes,
): SessionTokenPartsV1 & { readonly token: string } => {
  const parts = {
    sessionId: Buffer.from(randomBytes(SESSION_TOKEN_POLICY_V1.sessionIdBytes)),
    nonce: Buffer.from(randomBytes(SESSION_TOKEN_POLICY_V1.nonceBytes)),
  };
  return { ...parts, token: encodeSessionToken(parts, key) };
};

export const decodeAndVerifySessionToken = (
  token: string,
  key: SessionTokenKeyV1,
): SessionTokenPartsV1 | undefined => {
  assertTokenKey(key);
  if (typeof token !== "string" || token.length > 512) return undefined;
  const segments = token.split(".");
  if (segments.length !== 4 || segments[0] !== SESSION_TOKEN_POLICY_V1.prefix) return undefined;
  const sessionId = fromBase64Url(segments[1] ?? "");
  const nonce = fromBase64Url(segments[2] ?? "");
  const mac = fromBase64Url(segments[3] ?? "");
  if (
    sessionId === undefined ||
    nonce === undefined ||
    mac === undefined ||
    sessionId.length !== SESSION_TOKEN_POLICY_V1.sessionIdBytes ||
    nonce.length !== SESSION_TOKEN_POLICY_V1.nonceBytes ||
    mac.length !== SESSION_TOKEN_POLICY_V1.macBytes
  )
    return undefined;
  const expected = tokenMac({ sessionId, nonce }, key.hmacKey);
  if (!timingSafeEqual(expected, mac)) return undefined;
  return { sessionId, nonce };
};

export const sessionTokenSha256 = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");
