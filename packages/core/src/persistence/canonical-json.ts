import { createHash } from "node:crypto";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const stringify = (value: unknown, ancestors: Set<object>): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON only accepts finite numbers");
    }
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError("canonical JSON only accepts JSON values");
  }

  if (ancestors.has(value)) {
    throw new TypeError("canonical JSON does not accept circular values");
  }
  ancestors.add(value);

  let result: string;
  if (Array.isArray(value)) {
    const items = [] as string[];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError("canonical JSON does not accept sparse arrays");
      }
      items.push(stringify(value[index], ancestors));
    }
    result = `[${items.join(",")}]`;
  } else {
    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("canonical JSON only accepts plain objects");
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringify(value[key], ancestors)}`);
    result = `{${entries.join(",")}}`;
  }

  ancestors.delete(value);
  return result;
};

export const canonicalJson = (value: unknown): string => stringify(value, new Set());

export const canonicalizeJson = canonicalJson;

export const sha256CanonicalJson = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export const canonicalJsonSha256 = sha256CanonicalJson;

export const isJsonValue = (value: unknown): value is JsonValue => {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
};
