import { z } from "zod";

/**
 * Canonical decimal values used by C18 configuration boundaries.
 *
 * The wire form is a string with an optional sign, an integer part without
 * leading zeros, and at most six fractional digits with no trailing zero. All
 * comparisons and arithmetic below stay in `bigint`, because binary floating
 * point cannot decide shared boundaries exactly.
 */
export const CANONICAL_DECIMAL_MAX_FRACTION_DIGITS_V1 = 6;

const CANONICAL_DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{0,5}[1-9])?$/u;

export const isCanonicalDecimal = (value: string): boolean =>
  value !== "-0" && CANONICAL_DECIMAL_PATTERN.test(value);

export const CanonicalDecimalV1Schema = z.string().refine(isCanonicalDecimal, {
  message: "value must be a canonical decimal with at most six fractional digits",
});
export type CanonicalDecimalV1 = z.infer<typeof CanonicalDecimalV1Schema>;

export interface CanonicalDecimalValueV1 {
  /** Signed integer scaled by `10 ** scale`. */
  readonly units: bigint;
  /** Number of fractional digits, never negative. */
  readonly scale: number;
}

const assertScale = (scale: number): void => {
  if (!Number.isInteger(scale) || scale < 0 || scale > CANONICAL_DECIMAL_MAX_FRACTION_DIGITS_V1) {
    throw new RangeError("decimal scale is outside the supported range");
  }
};

const powerOfTen = (exponent: number): bigint => 10n ** BigInt(exponent);

export const parseCanonicalDecimal = (value: string): CanonicalDecimalValueV1 => {
  if (!isCanonicalDecimal(value)) throw new RangeError("value is not a canonical decimal");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const separator = unsigned.indexOf(".");
  const integerPart = separator === -1 ? unsigned : unsigned.slice(0, separator);
  const fractionPart = separator === -1 ? "" : unsigned.slice(separator + 1);
  const magnitude = BigInt(`${integerPart}${fractionPart}`);
  return { units: negative ? -magnitude : magnitude, scale: fractionPart.length };
};

export const canonicalDecimalToString = (value: CanonicalDecimalValueV1): string => {
  if (value.units === 0n) return "0";
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString();
  const padded = digits.padStart(value.scale + 1, "0");
  const integerPart = padded.slice(0, padded.length - value.scale);
  const fractionDigits = value.scale === 0 ? "" : padded.slice(padded.length - value.scale);
  const fractionPart = fractionDigits.replace(/0+$/u, "");
  const sign = negative ? "-" : "";
  return fractionPart.length === 0
    ? `${sign}${integerPart}`
    : `${sign}${integerPart}.${fractionPart}`;
};

export const compareCanonicalDecimalValues = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): -1 | 0 | 1 => {
  const scale = Math.max(left.scale, right.scale);
  const alignedLeft = left.units * powerOfTen(scale - left.scale);
  const alignedRight = right.units * powerOfTen(scale - right.scale);
  return alignedLeft < alignedRight ? -1 : alignedLeft > alignedRight ? 1 : 0;
};

export const compareCanonicalDecimal = (left: string, right: string): -1 | 0 | 1 =>
  compareCanonicalDecimalValues(parseCanonicalDecimal(left), parseCanonicalDecimal(right));

/**
 * Compare two wire values without throwing. Returns `undefined` when either
 * value is not a canonical decimal, so schema refinements can leave the format
 * error to the field schema instead of aborting validation.
 */
export const compareCanonicalDecimalValuesOrUndefined = (
  left: string,
  right: string,
): -1 | 0 | 1 | undefined =>
  isCanonicalDecimal(left) && isCanonicalDecimal(right)
    ? compareCanonicalDecimal(left, right)
    : undefined;

const align = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): readonly [bigint, bigint, number] => {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.units * powerOfTen(scale - left.scale),
    right.units * powerOfTen(scale - right.scale),
    scale,
  ];
};

export const addCanonicalDecimalValues = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => {
  const [scaledLeft, scaledRight, scale] = align(left, right);
  return { units: scaledLeft + scaledRight, scale };
};

export const subtractCanonicalDecimalValues = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => {
  const [scaledLeft, scaledRight, scale] = align(left, right);
  return { units: scaledLeft - scaledRight, scale };
};

export const multiplyCanonicalDecimalValues = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => ({
  units: left.units * right.units,
  scale: left.scale + right.scale,
});

export const DECIMAL_ROUNDING_MODE_V1_VALUES = ["half-away-from-zero"] as const;
export const DecimalRoundingModeV1Schema = z.enum(DECIMAL_ROUNDING_MODE_V1_VALUES);
export type DecimalRoundingModeV1 = z.infer<typeof DecimalRoundingModeV1Schema>;

export const roundCanonicalDecimalValue = (
  value: CanonicalDecimalValueV1,
  targetScale: number,
  mode: DecimalRoundingModeV1 = "half-away-from-zero",
): CanonicalDecimalValueV1 => {
  assertScale(targetScale);
  if (value.scale <= targetScale) {
    return { units: value.units * powerOfTen(targetScale - value.scale), scale: targetScale };
  }
  const divisor = powerOfTen(value.scale - targetScale);
  const quotient = value.units / divisor;
  const remainder = value.units % divisor;
  const doubledRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const roundsAway =
    mode === "half-away-from-zero" && doubledRemainder >= divisor && value.units !== 0n;
  return {
    units: roundsAway ? quotient + (value.units < 0n ? -1n : 1n) : quotient,
    scale: targetScale,
  };
};

export interface CanonicalDecimalBandV1 {
  readonly lower: CanonicalDecimalV1;
  readonly upper: CanonicalDecimalV1;
}

/**
 * Resolve a value to the index of its band using the fixed left-closed,
 * right-open rule and a right-closed final band. Returns `-1` when no band
 * contains the value.
 */
export const resolveCanonicalDecimalBandIndex = (
  bands: readonly CanonicalDecimalBandV1[],
  value: string,
): number => {
  const parsed = parseCanonicalDecimal(value);
  const lastIndex = bands.length - 1;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (band === undefined) continue;
    const lower = parseCanonicalDecimal(band.lower);
    const upper = parseCanonicalDecimal(band.upper);
    const aboveLower = compareCanonicalDecimalValues(parsed, lower) >= 0;
    const belowUpper =
      index === lastIndex
        ? compareCanonicalDecimalValues(parsed, upper) <= 0
        : compareCanonicalDecimalValues(parsed, upper) < 0;
    if (aboveLower && belowUpper) return index;
  }
  return -1;
};
