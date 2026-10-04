import {
  canonicalDecimalToString,
  compareCanonicalDecimalValues,
  isCanonicalDecimal,
  roundCanonicalDecimalValue,
  type CanonicalDecimalValueV1,
} from "../../assessment-config/index.js";

/**
 * C25 的有限 number 规范表示（D-06）。
 *
 * 公共评分契约使用有限 JavaScript number，而 C18 矩阵边界使用规范十进制。这里把每个
 * 已通过公共 Schema 的 number 按其 ECMAScript 最短往返十进制展开为有符号 `BigInt + scale`，
 * 使比较、加权乘加和 half-away-from-zero 舍入都不依赖二进制浮点边界；C18 的
 * `compareCanonicalDecimalValues`/`roundCanonicalDecimalValue`/`canonicalDecimalToString`
 * 是本表示的唯一边界语义事实源，不复制第二套比较实现。
 */

export const RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1 = 32;

const DECIMAL_TEXT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u;

const powerOfTen = (exponent: number): bigint => 10n ** BigInt(exponent);

const stripTrailingZeros = (value: CanonicalDecimalValueV1): CanonicalDecimalValueV1 => {
  let units = value.units;
  let scale = value.scale;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
};

/** 有限 number → 规范十进制；指数展开与尾零归一都在整数域完成。 */
export const decimalFromFiniteNumber = (value: number): CanonicalDecimalValueV1 => {
  if (!Number.isFinite(value)) {
    throw new RangeError("value must be a finite number");
  }
  const match = DECIMAL_TEXT_PATTERN.exec(String(value));
  if (match === null) {
    throw new RangeError("value has no decimal representation");
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const digits = `${match[2] ?? ""}${match[3] ?? ""}`;
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? "0");
  if (
    scale < -RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1 ||
    scale > RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1
  ) {
    throw new RangeError("value is outside the supported decimal range");
  }
  const units: bigint = scale < 0 ? BigInt(digits) * powerOfTen(-scale) : BigInt(digits);
  return stripTrailingZeros({ units: sign * units, scale: Math.max(scale, 0) });
};

export const decimalFromInteger = (value: number): CanonicalDecimalValueV1 => {
  if (!Number.isSafeInteger(value)) throw new RangeError("value must be a safe integer");
  return { units: BigInt(value), scale: 0 };
};

export const decimalIsZero = (value: CanonicalDecimalValueV1): boolean => value.units === 0n;

export const negateDecimals = (value: CanonicalDecimalValueV1): CanonicalDecimalValueV1 => ({
  units: -value.units,
  scale: value.scale,
});

export const compareDecimals = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): -1 | 0 | 1 => compareCanonicalDecimalValues(left, right);

export const multiplyDecimals = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => ({
  units: left.units * right.units,
  scale: left.scale + right.scale,
});

export const addDecimals = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 => {
  const scale = Math.max(left.scale, right.scale);
  return {
    units:
      left.units * powerOfTen(scale - left.scale) + right.units * powerOfTen(scale - right.scale),
    scale,
  };
};

/** `baseScore × basisPoints / 10000`：先精确乘基点，再把除数并入十进制尺度。 */
export const weightByBasisPoints = (
  baseScore: CanonicalDecimalValueV1,
  basisPoints: number,
): CanonicalDecimalValueV1 =>
  stripTrailingZeros({
    units: baseScore.units * BigInt(basisPoints),
    scale: baseScore.scale + 4,
  });

export const roundDecimal = (
  value: CanonicalDecimalValueV1,
  decimalScale: number,
): CanonicalDecimalValueV1 =>
  roundCanonicalDecimalValue(value, decimalScale, "half-away-from-zero");

/**
 * `left / right`，结果保留 `scale` 位小数：BigInt 对齐后精确相除，按 half-away-from-zero
 * 就近取值。分母为零没有定义，直接失败而不是回退成零或无穷。
 */
export const divideDecimals = (
  left: CanonicalDecimalValueV1,
  right: CanonicalDecimalValueV1,
  scale: number,
): CanonicalDecimalValueV1 => {
  if (right.units === 0n) throw new RangeError("division by zero");
  if (!Number.isInteger(scale) || scale < 0 || scale > RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1) {
    throw new RangeError("division scale is outside the supported range");
  }
  // left / right × 10^scale = (l.units × 10^(r.scale + scale)) / (r.units × 10^l.scale)
  const dividend = left.units * powerOfTen(right.scale + scale);
  const divisor = right.units * powerOfTen(left.scale);
  const negative = dividend < 0n !== divisor < 0n;
  const magnitudeDividend = dividend < 0n ? -dividend : dividend;
  const magnitudeDivisor = divisor < 0n ? -divisor : divisor;
  const quotient = magnitudeDividend / magnitudeDivisor;
  const remainder = magnitudeDividend % magnitudeDivisor;
  const units = remainder * 2n >= magnitudeDivisor ? quotient + 1n : quotient;
  return { units: negative ? -units : units, scale };
};

export const decimalToString = (value: CanonicalDecimalValueV1): string =>
  canonicalDecimalToString(value);

/** 规范十进制字符串；超出 C18 规范范围（>6 位小数或超长整数部分）时返回 `undefined`。 */
export const canonicalDecimalStringOf = (value: CanonicalDecimalValueV1): string | undefined => {
  const text = canonicalDecimalToString(value);
  return isCanonicalDecimal(text) ? text : undefined;
};

const decimalEquals = (left: CanonicalDecimalValueV1, right: CanonicalDecimalValueV1): boolean =>
  compareDecimals(left, right) === 0;

/** 最近可表示 number：仅要求有限，用于逐项加权贡献等展示字段。 */
export const decimalToNearestNumber = (value: CanonicalDecimalValueV1): number => {
  const parsed = Number(canonicalDecimalToString(value));
  if (!Number.isFinite(parsed)) throw new RangeError("value is not representable as a number");
  return parsed;
};

/** 精确可表示 number：要求往返到同一规范值，用于 P/C 等必须精确的公共字段。 */
export const decimalToExactNumber = (value: CanonicalDecimalValueV1): number => {
  const parsed = decimalToNearestNumber(value);
  if (!decimalEquals(decimalFromFiniteNumber(parsed), stripTrailingZeros(value))) {
    throw new RangeError("value does not round-trip to its canonical representation");
  }
  return parsed;
};
