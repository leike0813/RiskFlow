import {
  MonitoringAlignedPointV1Schema,
  MonitoringAvailabilityPolicyV1Schema,
  MonitoringFeatureResultV1Schema,
  MonitoringFeatureSetV1Schema,
  type MonitoringAlignedPointV1,
  type MonitoringAvailabilityPolicyV1,
  type MonitoringFeatureResultV1,
  type MonitoringFeatureSetV1,
  type MonitoringFeatureTypeV1,
  type MonitoringSampleVersionRefV1,
  type MonitoringUnitConversionV1,
} from "./schema.js";

export interface MonitoringFeatureSampleV1 {
  readonly sampledAt: string | number | Date;
  readonly value?: number;
  readonly unit?: string;
  readonly canonicalValue?: number;
  readonly canonicalUnit?: string;
  readonly sourceSampleKey?: string;
  readonly sampleVersionRef?: MonitoringSampleVersionRefV1;
}

export interface MonitoringFeatureInputV1 {
  readonly samples: readonly MonitoringFeatureSampleV1[];
  readonly cutoff: string | number | Date;
  readonly canonicalUnit: string;
  readonly policy: MonitoringAvailabilityPolicyV1;
}

export interface MonitoringFeatureComputationV1 {
  readonly alignedPoints: readonly MonitoringAlignedPointV1[];
  readonly features: MonitoringFeatureSetV1;
  readonly availability: "available" | "partial" | "unavailable";
  readonly coverageRatio: number;
  readonly availabilityReasons: readonly string[];
}

const finite = (value: number): number => {
  if (!Number.isFinite(value)) throw new RangeError("monitoring value must be finite");
  return value;
};

const millis = (value: string | number | Date): number => {
  const result =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError("monitoring timestamp must be valid");
  return result;
};

const iso = (value: number): string => {
  const result = new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(result)))
    throw new RangeError("monitoring timestamp must be valid");
  return result;
};

/** Convert one value with the revision's explicit affine unit rules. */
export const convertMonitoringValue = (
  value: number,
  fromUnit: string,
  canonicalUnit: string,
  conversions: readonly MonitoringUnitConversionV1[],
): number => {
  finite(value);
  if (fromUnit === canonicalUnit) return value;
  const rule = conversions.find((item) => item.fromUnit === fromUnit);
  if (rule === undefined) throw new RangeError(`unit conversion is not declared: ${fromUnit}`);
  return finite(value * rule.scale + rule.offset);
};

export const convertUnit = convertMonitoringValue;

const normalizeSamples = (
  input: readonly MonitoringFeatureSampleV1[],
  canonicalUnit: string,
): Array<{
  sampledAt: number;
  value: number;
  sourceSampleKey: string;
  sampleVersionRef?: MonitoringSampleVersionRefV1;
}> => {
  const samples = input.map((sample, index) => {
    const sampledAt = millis(sample.sampledAt);
    const value = sample.canonicalValue ?? sample.value;
    if (value === undefined) throw new RangeError(`sample ${index} has no value`);
    return {
      sampledAt,
      value: finite(value),
      sourceSampleKey: sample.sourceSampleKey ?? String(index),
      ...(sample.sampleVersionRef === undefined
        ? {}
        : { sampleVersionRef: sample.sampleVersionRef }),
      unit: sample.canonicalUnit ?? sample.unit ?? canonicalUnit,
    };
  });
  samples.sort(
    (left, right) =>
      left.sampledAt - right.sampledAt || left.sourceSampleKey.localeCompare(right.sourceSampleKey),
  );
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index]?.sampledAt === samples[index - 1]?.sampledAt) {
      throw new RangeError("monitoring samples must not share a timestamp");
    }
  }
  return samples.map(({ unit, ...sample }) => {
    if (unit !== canonicalUnit) {
      throw new RangeError(`sample is not in canonical unit: ${unit}`);
    }
    return sample;
  });
};

const point = (
  sampledAt: number,
  value: number | null,
  unit: string,
  status: MonitoringAlignedPointV1["status"],
  sourceSampleRefs: readonly MonitoringSampleVersionRefV1[],
  reasonCode?: string,
): MonitoringAlignedPointV1 =>
  MonitoringAlignedPointV1Schema.parse({
    sampledAt: iso(sampledAt),
    value,
    unit,
    status,
    sourceSampleRefs,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  });

/** Build a backward-looking grid and use only exact or bounded interpolation. */
export const alignMonitoringSamples = (
  samples: readonly MonitoringFeatureSampleV1[],
  cutoff: string | number | Date,
  canonicalUnit: string,
  policy: MonitoringAvailabilityPolicyV1,
): readonly MonitoringAlignedPointV1[] => {
  const validPolicy = MonitoringAvailabilityPolicyV1Schema.parse(policy);
  const cutoffMillis = millis(cutoff);
  const normalized = normalizeSamples(samples, canonicalUnit);
  const byTime = new Map(normalized.map((sample) => [sample.sampledAt, sample]));
  const first = cutoffMillis - validPolicy.windowDurationMs;
  const points: MonitoringAlignedPointV1[] = [];
  for (let sampledAt = cutoffMillis; sampledAt > first; sampledAt -= validPolicy.intervalMs) {
    const exact = byTime.get(sampledAt);
    if (exact !== undefined) {
      points.push(
        point(
          sampledAt,
          exact.value,
          canonicalUnit,
          "available",
          exact.sampleVersionRef === undefined ? [] : [exact.sampleVersionRef],
        ),
      );
      continue;
    }
    let rightIndex = normalized.findIndex((sample) => sample.sampledAt > sampledAt);
    if (rightIndex < 0) rightIndex = normalized.length;
    const left = normalized[rightIndex - 1];
    const right = normalized[rightIndex];
    if (
      left !== undefined &&
      right !== undefined &&
      right.sampledAt - left.sampledAt <= validPolicy.maxInterpolationGapMs
    ) {
      const ratio = (sampledAt - left.sampledAt) / (right.sampledAt - left.sampledAt);
      const value = left.value + (right.value - left.value) * ratio;
      if (!Number.isFinite(value)) {
        points.push(point(sampledAt, null, canonicalUnit, "missing", [], "numeric-degenerate"));
        continue;
      }
      const refs = [left.sampleVersionRef, right.sampleVersionRef].filter(
        (ref): ref is MonitoringSampleVersionRefV1 => ref !== undefined,
      );
      points.push(point(sampledAt, value, canonicalUnit, "interpolated", refs));
    } else {
      points.push(
        point(sampledAt, null, canonicalUnit, "missing", [], "no-exact-or-bounded-sample"),
      );
    }
  }
  points.reverse();
  return points;
};

export const buildAlignedGrid = alignMonitoringSamples;
export const alignMonitoringGrid = alignMonitoringSamples;

type ValidPoint = MonitoringAlignedPointV1 & { value: number };

const validPoint = (value: MonitoringAlignedPointV1): value is ValidPoint =>
  value.value !== null && Number.isFinite(value.value) && value.status !== "missing";

const trailingValidRun = (points: readonly MonitoringAlignedPointV1[]): ValidPoint[] => {
  let start = points.length;
  while (start > 0 && validPoint(points[start - 1]!)) start -= 1;
  return points.slice(start).filter(validPoint);
};

const unavailable = (
  featureType: MonitoringFeatureTypeV1,
  windowSize: number,
  algorithmVersion: string,
  reasonCode: string,
  inputCount = 0,
  unit?: string,
): MonitoringFeatureResultV1 =>
  MonitoringFeatureResultV1Schema.parse({
    featureType,
    windowSize,
    inputCount,
    algorithmVersion,
    status: "unavailable",
    ...(unit === undefined ? {} : { unit }),
    reasonCode,
  });

const available = (
  featureType: MonitoringFeatureTypeV1,
  value: number,
  unit: string | undefined,
  windowSize: number,
  inputCount: number,
  algorithmVersion: string,
): MonitoringFeatureResultV1 =>
  MonitoringFeatureResultV1Schema.parse({
    featureType,
    value: finite(value),
    ...(unit === undefined ? {} : { unit }),
    windowSize,
    inputCount,
    algorithmVersion,
    status: "available",
  });

const ols = (values: readonly number[], stepSeconds: number): number | undefined => {
  if (values.length < 2 || !Number.isFinite(stepSeconds) || stepSeconds <= 0) return undefined;
  const meanX = (values.length - 1) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(sumY)) return undefined;
  const meanY = sumY / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = index * stepSeconds - meanX * stepSeconds;
    numerator += x * (values[index]! - meanY);
    denominator += x * x;
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return undefined;
  }
  if (denominator === 0) return undefined;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : undefined;
};

export const calculateShortTermSlope = (
  points: readonly MonitoringAlignedPointV1[],
  windowSize: number,
  algorithmVersion: string,
  canonicalUnit: string,
  intervalMs: number,
): MonitoringFeatureResultV1 => {
  const run = trailingValidRun(points);
  if (run.length < windowSize) {
    return unavailable(
      "short-term-slope",
      windowSize,
      algorithmVersion,
      "insufficient-continuous-points",
      run.length,
      `${canonicalUnit}/s`,
    );
  }
  const values = run.slice(-windowSize).map((item) => item.value);
  const value = ols(values, intervalMs / 1000);
  return value === undefined
    ? unavailable(
        "short-term-slope",
        windowSize,
        algorithmVersion,
        "insufficient-continuous-points",
        values.length,
        `${canonicalUnit}/s`,
      )
    : available(
        "short-term-slope",
        value,
        `${canonicalUnit}/s`,
        windowSize,
        values.length,
        algorithmVersion,
      );
};

export const calculateAcceleration = (
  points: readonly MonitoringAlignedPointV1[],
  windowSize: number,
  algorithmVersion: string,
  canonicalUnit: string,
  intervalMs: number,
): MonitoringFeatureResultV1 => {
  const fullRun = trailingValidRun(points);
  if (fullRun.length < windowSize) {
    return unavailable(
      "acceleration",
      windowSize,
      algorithmVersion,
      "insufficient-continuous-points",
      fullRun.length,
      `${canonicalUnit}/s^2`,
    );
  }
  const run = fullRun.slice(-windowSize);
  const slopes: number[] = [];
  for (let index = 1; index < run.length; index += 1) {
    const slope = (run[index]!.value - run[index - 1]!.value) / (intervalMs / 1000);
    if (!Number.isFinite(slope)) {
      return unavailable(
        "acceleration",
        windowSize,
        algorithmVersion,
        "numeric-degenerate",
        run.length,
        `${canonicalUnit}/s^2`,
      );
    }
    slopes.push(slope);
  }
  const value = ols(slopes, intervalMs / 1000);
  return value === undefined
    ? unavailable(
        "acceleration",
        windowSize,
        algorithmVersion,
        "insufficient-continuous-points",
        run.length,
        `${canonicalUnit}/s^2`,
      )
    : available(
        "acceleration",
        value,
        `${canonicalUnit}/s^2`,
        windowSize,
        slopes.length,
        algorithmVersion,
      );
};

export const calculateDominantFrequency = (
  points: readonly MonitoringAlignedPointV1[],
  windowSize: number,
  algorithmVersion: string,
  intervalMs: number,
  powerFloor: number,
): MonitoringFeatureResultV1 => {
  const fullRun = trailingValidRun(points);
  if (fullRun.length < windowSize) {
    return unavailable(
      "dominant-frequency",
      windowSize,
      algorithmVersion,
      "insufficient-continuous-points",
      fullRun.length,
      "Hz",
    );
  }
  const run = fullRun.slice(-windowSize);
  const n = run.length;
  if (n < 2)
    return unavailable(
      "dominant-frequency",
      windowSize,
      algorithmVersion,
      "insufficient-continuous-points",
      n,
      "Hz",
    );
  const sum = run.reduce((total, item) => total + item.value, 0);
  if (!Number.isFinite(sum)) {
    return unavailable(
      "dominant-frequency",
      windowSize,
      algorithmVersion,
      "numeric-degenerate",
      n,
      "Hz",
    );
  }
  const mean = sum / n;
  const centered = run.map((item) => item.value - mean);
  if (centered.some((value) => !Number.isFinite(value))) {
    return unavailable(
      "dominant-frequency",
      windowSize,
      algorithmVersion,
      "numeric-degenerate",
      n,
      "Hz",
    );
  }
  // 恒值窗口去均值后只剩浮点残差，经 Hann 窗后非零，但本无主峰。
  if (run.every((item) => item.value === run[0]!.value)) {
    return unavailable(
      "dominant-frequency",
      windowSize,
      algorithmVersion,
      "no-dominant-frequency",
      n,
      "Hz",
    );
  }
  let bestFrequency: number | undefined;
  let bestPower = powerFloor;
  for (let k = 1; k <= Math.floor(n / 2); k += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < n; index += 1) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (n - 1)));
      const angle = (2 * Math.PI * k * index) / n;
      real += centered[index]! * window * Math.cos(angle);
      imaginary -= centered[index]! * window * Math.sin(angle);
    }
    const power = real * real + imaginary * imaginary;
    if (!Number.isFinite(real) || !Number.isFinite(imaginary) || !Number.isFinite(power)) {
      return unavailable(
        "dominant-frequency",
        windowSize,
        algorithmVersion,
        "numeric-degenerate",
        n,
        "Hz",
      );
    }
    const frequency = k / (n * (intervalMs / 1000));
    if (
      power > bestPower ||
      (power === bestPower && bestFrequency !== undefined && frequency < bestFrequency)
    ) {
      bestPower = power;
      bestFrequency = frequency;
    }
  }
  return bestFrequency === undefined
    ? unavailable(
        "dominant-frequency",
        windowSize,
        algorithmVersion,
        "no-dominant-frequency",
        n,
        "Hz",
      )
    : available("dominant-frequency", bestFrequency, "Hz", windowSize, n, algorithmVersion);
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

export const calculateAnomalyScore = (
  points: readonly MonitoringAlignedPointV1[],
  baselineSize: number,
  scaleFloor: number,
  algorithmVersion: string,
): MonitoringFeatureResultV1 => {
  const run = trailingValidRun(points);
  if (run.length < baselineSize + 1) {
    return unavailable(
      "anomaly-score",
      baselineSize + 1,
      algorithmVersion,
      "insufficient-baseline-points",
      run.length,
      "score",
    );
  }
  const current = run.at(-1)!.value;
  const baseline = run.slice(-(baselineSize + 1), -1).map((item) => item.value);
  const center = median(baseline);
  if (!Number.isFinite(center)) {
    return unavailable(
      "anomaly-score",
      baselineSize + 1,
      algorithmVersion,
      "numeric-degenerate",
      run.length,
      "score",
    );
  }
  const mad = median(baseline.map((value) => Math.abs(value - center)));
  const denominator = Math.max(1.4826 * mad, scaleFloor);
  const score = (current - center) / denominator;
  return Number.isFinite(mad) && Number.isFinite(denominator) && Number.isFinite(score)
    ? available(
        "anomaly-score",
        score,
        "score",
        baselineSize + 1,
        baseline.length,
        algorithmVersion,
      )
    : unavailable(
        "anomaly-score",
        baselineSize + 1,
        algorithmVersion,
        "numeric-degenerate",
        run.length,
        "score",
      );
};

const featureKey = (type: MonitoringFeatureTypeV1): keyof MonitoringFeatureSetV1 => {
  if (type === "short-term-slope") return "shortTermSlope";
  if (type === "dominant-frequency") return "dominantFrequency";
  if (type === "anomaly-score") return "anomalyScore";
  return "acceleration";
};

export const computeMonitoringFeatures = (
  input: MonitoringFeatureInputV1 | readonly MonitoringFeatureSampleV1[],
  cutoff?: string | number | Date,
  policy?: MonitoringAvailabilityPolicyV1,
  canonicalUnit?: string,
): MonitoringFeatureComputationV1 => {
  let resolved: MonitoringFeatureInputV1;
  if (Array.isArray(input)) {
    if (cutoff === undefined || policy === undefined) {
      throw new TypeError("cutoff and policy are required for positional feature input");
    }
    resolved = {
      samples: input,
      cutoff,
      policy: MonitoringAvailabilityPolicyV1Schema.parse(policy),
      canonicalUnit: canonicalUnit ?? input[0]?.canonicalUnit ?? input[0]?.unit ?? "1",
    };
  } else {
    resolved = input as MonitoringFeatureInputV1;
  }
  const validPolicy = MonitoringAvailabilityPolicyV1Schema.parse(resolved.policy);
  const alignedPoints = alignMonitoringSamples(
    resolved.samples,
    resolved.cutoff,
    resolved.canonicalUnit,
    validPolicy,
  );
  const features = MonitoringFeatureSetV1Schema.parse({
    shortTermSlope: calculateShortTermSlope(
      alignedPoints,
      validPolicy.slopeWindowSize,
      validPolicy.algorithmVersions.slope,
      resolved.canonicalUnit,
      validPolicy.intervalMs,
    ),
    acceleration: calculateAcceleration(
      alignedPoints,
      validPolicy.accelerationWindowSize,
      validPolicy.algorithmVersions.acceleration,
      resolved.canonicalUnit,
      validPolicy.intervalMs,
    ),
    dominantFrequency: calculateDominantFrequency(
      alignedPoints,
      validPolicy.frequencyWindowSize,
      validPolicy.algorithmVersions.frequency,
      validPolicy.intervalMs,
      validPolicy.frequencyPowerFloor,
    ),
    anomalyScore: calculateAnomalyScore(
      alignedPoints,
      validPolicy.anomalyBaselineSize,
      validPolicy.anomalyScaleFloor,
      validPolicy.algorithmVersions.anomaly,
    ),
  });
  const validCount = alignedPoints.filter(validPoint).length;
  const coverageRatio = alignedPoints.length === 0 ? 0 : validCount / alignedPoints.length;
  const reasons = new Set<string>();
  if (validCount === 0) reasons.add("no-valid-samples");
  if (validCount < alignedPoints.length) reasons.add("missing-grid-points");
  if (coverageRatio < validPolicy.minimumCoverageRatio) reasons.add("coverage-below-threshold");
  for (const feature of Object.values(features)) {
    if (feature.status === "unavailable" && feature.reasonCode !== undefined)
      reasons.add(feature.reasonCode);
  }
  const availability =
    validCount === 0 || coverageRatio < validPolicy.minimumCoverageRatio
      ? "unavailable"
      : reasons.size === 0
        ? "available"
        : "partial";
  return {
    alignedPoints,
    features,
    availability,
    coverageRatio,
    availabilityReasons: [...reasons],
  };
};

export const computeFeatures = computeMonitoringFeatures;
export const featureTypeToKey = featureKey;
