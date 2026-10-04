import {
  canonicalDecimalToString,
  compareCanonicalDecimalValues,
  isCanonicalDecimal,
  parseCanonicalDecimal,
  roundCanonicalDecimalValue,
  type CanonicalDecimalValueV1,
} from "../assessment-config/index.js";
import {
  addDecimals,
  decimalFromFiniteNumber,
  decimalFromInteger,
  decimalIsZero,
  divideDecimals,
  multiplyDecimals,
  negateDecimals,
  RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1,
} from "../risk-assessment/engine/decimal.js";

import {
  EffectForecastModelArtifactV1Schema,
  type EffectForecastModelArtifactV1,
} from "./schema.js";

/**
 * C28 的三类生产参数预测算法（design D-06/D-07）。
 *
 * 这里只有确定性的规范十进制算术：系数、区间与措施效果全部来自模型工件和正式措施，
 * 执行器与装配代码不提供任何默认值。三种方法互不回退——缺参数、样本不足或退化窗口
 * 只会得到类型化不可用，非法输入则直接拒绝，绝不返回部分结果或沿用基线风险状态。
 *
 * 全程只用 `CanonicalDecimalValueV1`：加减乘与除法都在 BigInt 域完成，仅在除法与最终
 * 输出按模型 `calculationScale` 做 half-away-from-zero，不依赖二进制浮点边界。
 */

type HistoricalStatisticsModelV1 = Extract<
  EffectForecastModelArtifactV1,
  { method: "historical-statistics" }
>;
type MonitoringTrendModelV1 = Extract<
  EffectForecastModelArtifactV1,
  { method: "monitoring-trend" }
>;
type MechanismModelV1 = Extract<EffectForecastModelArtifactV1, { method: "mechanism-model" }>;

/** 合法输入但不足以计算：稳定的不可用原因，不是失败。 */
export const FORECAST_UNAVAILABLE_REASONS_V1 = [
  "input-indicator-missing",
  "monitoring-window-insufficient",
  "monitoring-slope-degenerate",
] as const;
export type ForecastUnavailableReasonV1 = (typeof FORECAST_UNAVAILABLE_REASONS_V1)[number];

/** 输入与模型声明或工件本身不相容：关闭失败，绝不夹取、换算或猜测。 */
export const FORECAST_REJECTED_REASONS_V1 = [
  "model-unreadable",
  "method-mismatch",
  "horizon-out-of-range",
  "measure-unsupported",
  "input-out-of-domain",
  "result-out-of-domain",
] as const;
export type ForecastRejectedReasonV1 = (typeof FORECAST_REJECTED_REASONS_V1)[number];

export type EffectForecastComputationV1 =
  | {
      readonly kind: "value";
      /** 已按模型 calculationScale 取整的规范十进制，可逐字符重放。 */
      readonly value: string;
    }
  | { readonly kind: "unavailable"; readonly reason: ForecastUnavailableReasonV1 }
  | { readonly kind: "rejected"; readonly reason: ForecastRejectedReasonV1 };

/**
 * 正式措施标识：只来自已采纳建议。措施效果一律从模型工件按措施库版本绑定，执行器与算法
 * 都不接受调用方自带的效果值，也不按缺省零效果补齐。
 */
export type ForecastMeasureV1 = { readonly measureId: string };

/** 冻结基线的实际取值：缺失就是缺失，不把布尔或非数值字符串强转成数字。 */
export type ForecastBaselineValueV1 = {
  readonly indicatorId: string;
  readonly value: string;
};

/** 执行前监测快照的一个对齐槽；算法只采用 status 为 available 的槽。 */
export type ForecastAlignedPointV1 = {
  readonly sampledAt: string;
  readonly value: number | null;
  readonly unit: string;
  readonly status: "available" | "interpolated" | "missing";
};

export type HistoricalStatisticsForecastRequestV1 = {
  readonly method: "historical-statistics";
  /** 未解析的模型工件正文：由本入口按所属 Schema 解析，解析失败不进入任何算法。 */
  readonly model: unknown;
  readonly horizonSteps: number;
  readonly baselineValues: readonly ForecastBaselineValueV1[];
  readonly measures: readonly ForecastMeasureV1[];
};

export type MonitoringTrendForecastRequestV1 = {
  readonly method: "monitoring-trend";
  readonly model: unknown;
  readonly horizonSteps: number;
  /** 执行前快照的截止时刻：用于核对末尾槽按声明步长对齐。 */
  readonly cutoff: string;
  readonly alignedPoints: readonly ForecastAlignedPointV1[];
  readonly measures: readonly ForecastMeasureV1[];
};

export type MechanismForecastRequestV1 = {
  readonly method: "mechanism-model";
  readonly model: unknown;
  readonly horizonSteps: number;
  readonly baselineValues: readonly ForecastBaselineValueV1[];
  readonly measures: readonly ForecastMeasureV1[];
};

export type EffectForecastRequestV1 =
  | HistoricalStatisticsForecastRequestV1
  | MonitoringTrendForecastRequestV1
  | MechanismForecastRequestV1;

/* -------------------------------------------------------------------------- */
/* 规范十进制算术                                                              */
/* -------------------------------------------------------------------------- */

const zero = (): CanonicalDecimalValueV1 => ({ units: 0n, scale: 0 });

const sum = (values: readonly CanonicalDecimalValueV1[]): CanonicalDecimalValueV1 =>
  values.reduce<CanonicalDecimalValueV1>(addDecimals, zero());

/** 1/2/3 次幂在十进制域完成，避免先落成浮点再相乘。 */
const powerOf = (base: CanonicalDecimalValueV1, power: 1 | 2 | 3): CanonicalDecimalValueV1 => {
  if (power === 1) return base;
  const squared = multiplyDecimals(base, base);
  return power === 2 ? squared : multiplyDecimals(squared, base);
};

const within = (
  value: CanonicalDecimalValueV1,
  domain: { readonly lower: string; readonly upper: string },
): boolean =>
  compareCanonicalDecimalValues(value, parseCanonicalDecimal(domain.lower)) >= 0 &&
  compareCanonicalDecimalValues(value, parseCanonicalDecimal(domain.upper)) <= 0;

const canonicalValues = (
  entries: readonly ForecastBaselineValueV1[],
): ReadonlyMap<string, CanonicalDecimalValueV1> =>
  new Map(
    entries
      .filter((entry) => isCanonicalDecimal(entry.value))
      .map((entry) => [entry.indicatorId, parseCanonicalDecimal(entry.value)]),
  );

/**
 * 正式措施的总调整 `E = Σ(offset + perStep × h)`。模型只对声明过的措施给出效果，
 * 传入未声明的措施即为装配错误，不允许按零效果继续。
 */
const measureAdjustment = (
  model: EffectForecastModelArtifactV1,
  measures: readonly ForecastMeasureV1[],
  horizonSteps: number,
): CanonicalDecimalValueV1 | ForecastRejectedReasonV1 => {
  const declared = new Map(model.measureEffects.map((effect) => [effect.measureId, effect]));
  const horizon = decimalFromInteger(horizonSteps);
  let total = zero();
  for (const measure of measures) {
    const effect = declared.get(measure.measureId);
    if (effect === undefined) return "measure-unsupported";
    total = addDecimals(
      total,
      addDecimals(
        parseCanonicalDecimal(effect.offset),
        multiplyDecimals(parseCanonicalDecimal(effect.perStep), horizon),
      ),
    );
  }
  return total;
};

/** 按模型 calculationScale 取整并规范输出；超出规范表示范围按非法结果拒绝，不截断。 */
const finish = (
  model: EffectForecastModelArtifactV1,
  measures: readonly ForecastMeasureV1[],
  horizonSteps: number,
  raw: CanonicalDecimalValueV1,
): EffectForecastComputationV1 => {
  const adjustment = measureAdjustment(model, measures, horizonSteps);
  if (typeof adjustment === "string") return { kind: "rejected", reason: adjustment };
  const text = canonicalDecimalToString(
    roundCanonicalDecimalValue(
      addDecimals(raw, adjustment),
      model.calculationScale,
      "half-away-from-zero",
    ),
  );
  return isCanonicalDecimal(text)
    ? { kind: "value", value: text }
    : { kind: "rejected", reason: "result-out-of-domain" };
};

/* -------------------------------------------------------------------------- */
/* 方法一：历史统计（已训练线性回归系数）                                      */
/* -------------------------------------------------------------------------- */

const historicalStatisticsValue = (
  model: HistoricalStatisticsModelV1,
  horizonSteps: number,
  baselineValues: readonly ForecastBaselineValueV1[],
): CanonicalDecimalValueV1 | ForecastUnavailableReasonV1 => {
  const available = canonicalValues(baselineValues);
  const contributions: CanonicalDecimalValueV1[] = [];
  for (const [index, indicator] of model.inputIndicators.entries()) {
    const value = available.get(indicator.indicatorId);
    if (value === undefined) return "input-indicator-missing";
    const coefficient = model.parameters.inputCoefficients[index]?.coefficient;
    if (coefficient === undefined) return "input-indicator-missing";
    contributions.push(multiplyDecimals(value, parseCanonicalDecimal(coefficient)));
  }
  return sum([
    parseCanonicalDecimal(model.parameters.intercept),
    ...contributions,
    multiplyDecimals(
      parseCanonicalDecimal(model.parameters.horizonCoefficient),
      decimalFromInteger(horizonSteps),
    ),
  ]);
};

/* -------------------------------------------------------------------------- */
/* 方法二：监测趋势（原对齐槽下标的最小二乘外推）                             */
/* -------------------------------------------------------------------------- */

/**
 * 取执行前快照末尾 `windowPoints` 个对齐槽，只保留 observed、有值且同单位的点。
 * 横轴用这些点在原对齐数组中的下标，缺槽不压缩、不插值——一个缺槽会真实拉开两点的
 * 横轴距离，而不是被悄悄抹平。
 */
const trendPoints = (
  model: MonitoringTrendModelV1,
  alignedPoints: readonly ForecastAlignedPointV1[],
): readonly { readonly x: number; readonly y: CanonicalDecimalValueV1 }[] => {
  const offset = alignedPoints.length - model.parameters.windowPoints;
  return alignedPoints
    .slice(offset < 0 ? 0 : offset)
    .map((point, index) => ({ point, x: (offset < 0 ? 0 : offset) + index }))
    .filter(({ point }) => point.status === "available" && point.value !== null)
    .filter(({ point }) => point.unit === model.unit)
    .map(({ point, x }) => ({ x, y: decimalFromFiniteNumber(point.value as number) }));
};

/** 末尾槽必须严格递增且按声明步长落在截止时刻之后，否则趋势的时间轴没有意义。 */
const alignedToStep = (
  model: MonitoringTrendModelV1,
  cutoff: string,
  alignedPoints: readonly ForecastAlignedPointV1[],
): boolean => {
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs)) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of alignedPoints) {
    const sampledMs = Date.parse(point.sampledAt);
    if (!Number.isFinite(sampledMs) || sampledMs <= previous) return false;
    previous = sampledMs;
    if (sampledMs > cutoffMs || (cutoffMs - sampledMs) % model.stepMs !== 0) return false;
  }
  return true;
};

const monitoringTrendValue = (
  model: MonitoringTrendModelV1,
  horizonSteps: number,
  cutoff: string,
  alignedPoints: readonly ForecastAlignedPointV1[],
): CanonicalDecimalValueV1 | ForecastUnavailableReasonV1 | "monitoring-slope-degenerate" => {
  if (!alignedToStep(model, cutoff, alignedPoints)) return "monitoring-window-insufficient";
  const points = trendPoints(model, alignedPoints);
  if (points.length < 2) return "monitoring-window-insufficient";
  const count = decimalFromInteger(points.length);
  const sumX = sum(points.map((point) => decimalFromInteger(point.x)));
  const sumY = sum(points.map((point) => point.y));
  const sumXY = sum(points.map((point) => multiplyDecimals(decimalFromInteger(point.x), point.y)));
  const sumXX = sum(
    points.map((point) =>
      multiplyDecimals(decimalFromInteger(point.x), decimalFromInteger(point.x)),
    ),
  );
  // slope = (nΣxy − ΣxΣy) / (nΣx² − (Σx)²)；分母为零即退化窗口，不给出斜率。
  const denominator = addDecimals(
    multiplyDecimals(count, sumXX),
    negateDecimals(multiplyDecimals(sumX, sumX)),
  );
  if (decimalIsZero(denominator)) return "monitoring-slope-degenerate";
  const slope = divideDecimals(
    addDecimals(multiplyDecimals(count, sumXY), negateDecimals(multiplyDecimals(sumX, sumY))),
    denominator,
    RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1,
  );
  // 截距由样本均值与斜率得出，外推到最后一个对齐槽再加时域步数。
  const meanY = divideDecimals(sumY, count, RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1);
  const meanX = divideDecimals(sumX, count, RISK_ASSESSMENT_DECIMAL_MAX_SCALE_V1);
  const intercept = addDecimals(meanY, negateDecimals(multiplyDecimals(slope, meanX)));
  return addDecimals(
    intercept,
    multiplyDecimals(slope, decimalFromInteger(points[points.length - 1]!.x + horizonSteps)),
  );
};

/* -------------------------------------------------------------------------- */
/* 方法三：机理（有界多项式参数）                                              */
/* -------------------------------------------------------------------------- */

const mechanismValue = (
  model: MechanismModelV1,
  horizonSteps: number,
  baselineValues: readonly ForecastBaselineValueV1[],
): MechanismComputationV1 => {
  const available = canonicalValues(baselineValues);
  const domains = new Map(model.parameters.inputDomains.map((entry) => [entry.indicatorId, entry]));
  const inputs = new Map<string, CanonicalDecimalValueV1>();
  for (const indicator of model.inputIndicators) {
    const value = available.get(indicator.indicatorId);
    if (value === undefined) return { kind: "unavailable", reason: "input-indicator-missing" };
    // 输入越出声明物理区间即关闭失败：夹取会把非法状态隐藏成看似合法的预测。
    const domain = domains.get(indicator.indicatorId);
    if (domain === undefined || !within(value, domain.domain)) {
      return { kind: "rejected", reason: "input-out-of-domain" };
    }
    inputs.set(indicator.indicatorId, value);
  }
  const contributions: CanonicalDecimalValueV1[] = [];
  for (const term of model.parameters.terms) {
    const base = inputs.get(term.indicatorId);
    if (base === undefined) return { kind: "rejected", reason: "input-out-of-domain" };
    contributions.push(
      multiplyDecimals(parseCanonicalDecimal(term.coefficient), powerOf(base, term.power)),
    );
  }
  const predicted = sum([
    parseCanonicalDecimal(model.parameters.intercept),
    ...contributions,
    multiplyDecimals(
      parseCanonicalDecimal(model.parameters.horizonCoefficient),
      decimalFromInteger(horizonSteps),
    ),
  ]);
  // 结果必须落在声明输出区间内，否则视为非法结果而不是有效预测。
  return within(predicted, model.parameters.outputDomain)
    ? { kind: "value", raw: predicted }
    : { kind: "rejected", reason: "result-out-of-domain" };
};

type MechanismComputationV1 =
  | { readonly kind: "value"; readonly raw: CanonicalDecimalValueV1 }
  | { readonly kind: "unavailable"; readonly reason: ForecastUnavailableReasonV1 }
  | { readonly kind: "rejected"; readonly reason: ForecastRejectedReasonV1 };

/* -------------------------------------------------------------------------- */
/* 统一入口                                                                    */
/* -------------------------------------------------------------------------- */

export const computeEffectForecast = (
  request: EffectForecastRequestV1,
): EffectForecastComputationV1 => {
  // 模型工件不满足所属 Schema 时不进入任何算法：缺参数不能按默认零值补齐。
  const parsed = EffectForecastModelArtifactV1Schema.safeParse(request.model);
  if (!parsed.success) return { kind: "rejected", reason: "model-unreadable" };
  const model = parsed.data;
  const { horizonSteps } = request;
  // 三种方法互不回退：模型方法与请求方法不同即关闭失败，不做隐式方法切换。
  if (model.method !== request.method) return { kind: "rejected", reason: "method-mismatch" };
  if (
    !Number.isSafeInteger(horizonSteps) ||
    horizonSteps < 1 ||
    horizonSteps > model.maxHorizonSteps
  ) {
    return { kind: "rejected", reason: "horizon-out-of-range" };
  }
  switch (model.method) {
    case "historical-statistics": {
      if (request.method !== "historical-statistics") {
        return { kind: "rejected", reason: "method-mismatch" };
      }
      const raw = historicalStatisticsValue(model, horizonSteps, request.baselineValues);
      return typeof raw === "string"
        ? { kind: "unavailable", reason: raw }
        : finish(model, request.measures, horizonSteps, raw);
    }
    case "monitoring-trend": {
      if (request.method !== "monitoring-trend") {
        return { kind: "rejected", reason: "method-mismatch" };
      }
      const raw = monitoringTrendValue(model, horizonSteps, request.cutoff, request.alignedPoints);
      return typeof raw === "string"
        ? { kind: "unavailable", reason: raw }
        : finish(model, request.measures, horizonSteps, raw);
    }
    case "mechanism-model": {
      if (request.method !== "mechanism-model") {
        return { kind: "rejected", reason: "method-mismatch" };
      }
      const computed = mechanismValue(model, horizonSteps, request.baselineValues);
      return computed.kind === "value"
        ? finish(model, request.measures, horizonSteps, computed.raw)
        : computed;
    }
  }
};
