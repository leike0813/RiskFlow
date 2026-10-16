import { z } from "zod";

import type { VersionReference } from "@riskflow/contracts/common";
import type {
  AssessmentInputSnapshotRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EffectForecastRefV1,
  ExecutionRecordRefV1,
  FeedbackRefV1,
  MonitoringSnapshotRefV1,
  RiskAssessmentRecordRefV1,
  RiskInputVersionRefV1,
  SpatialScopeRefV1,
  WarningRecordRefV1,
  WarningResponseRecordCommandV1,
  WarningResponseRecordResultV1,
  WarningResponseTaskRefV1,
} from "@riskflow/contracts/ports";
import { ModuleErrorV1Schema } from "@riskflow/contracts/ports";
import type {
  ResponseRecommendation,
  RiskAssessmentRecord,
  RiskState,
} from "@riskflow/contracts/records";

import {
  addCanonicalDecimalValues,
  canonicalDecimalToString,
  compareCanonicalDecimalValues,
  parseCanonicalDecimal,
  roundCanonicalDecimalValue,
  type CanonicalDecimalValueV1,
} from "../assessment-config/index.js";
import type { MonitoringSnapshotV1 } from "../engineering-data/monitoring/index.js";
import { sha256CanonicalJson } from "../persistence/index.js";
import { decimalFromFiniteNumber } from "../risk-assessment/engine/index.js";

import {
  ResponseDeviationFactRefV1Schema,
  ResponseDeviationFactV1Schema,
  ResponseForecastExecutorResultV1Schema,
  ResponseForecastOutcomeV1Schema,
  type ResponseDeviationDirectionV1,
  type ResponseForecastExecutorResultV1,
} from "./schema.js";

/* -------------------------------------------------------------------------- */
/* D-07：偏差纯计算（规范十进制与整数交叉乘法，不用二进制浮点决定阈值）           */
/* -------------------------------------------------------------------------- */

export const RESPONSE_DEVIATION_MAX_SCALE_V1 = 6;

export const RESPONSE_DEVIATION_UNAVAILABLE_REASONS_V1 = [
  "target-indicator-missing",
  "value-not-numeric",
  "unit-mismatch",
  "basis-incompatible",
  "risk-level-ordinal-missing",
] as const;
export type ResponseDeviationUnavailableReasonV1 =
  (typeof RESPONSE_DEVIATION_UNAVAILABLE_REASONS_V1)[number];

export interface ResponseDeviationComputationV1 {
  readonly basis: "absolute" | "relative" | "risk-level-step";
  /** 规范十进制偏差值；relative 与超出六位小数的差值按 half-away-from-zero 舍入。 */
  readonly deviationValue: string;
  /** 只用于展示与 C29 组合的有限 number，不反向参与阈值判定。 */
  readonly deviationValueNumber: number;
  readonly thresholdExceeded: boolean;
  readonly direction: ResponseDeviationDirectionV1;
}

export type ResponseDeviationComputationResultV1 =
  | { readonly kind: "computed"; readonly computation: ResponseDeviationComputationV1 }
  | { readonly kind: "unavailable"; readonly reasonCode: ResponseDeviationUnavailableReasonV1 };

/**
 * 偏差计算输入：只接受已冻结事实。
 *
 * `riskLevelOrdinals` 来自同一冻结风险矩阵；`actualUnit` 只由同一冻结指标体系的规范单位给出，
 * 因而绝对/相对策略比较的是同一目标指标与同一单位。
 */
export interface ResponseDeviationInputV1 {
  readonly basis: "absolute" | "relative" | "risk-level-step";
  /** absolute/relative 的冻结阈值；risk-level-step 不使用。 */
  readonly threshold?: string;
  readonly minimumBaseline?: string;
  /** risk-level-step 的允许步数；absolute/relative 不使用。 */
  readonly levelStep?: number;
  readonly unit: string;
  readonly actualUnit: string;
  readonly predictedValue: string;
  readonly actualValue: number;
  readonly predictedRiskState: RiskState;
  readonly actualRiskState: RiskState;
  readonly riskLevelOrdinals: ReadonlyMap<string, number>;
}

const unavailable = (
  reasonCode: ResponseDeviationUnavailableReasonV1,
): ResponseDeviationComputationResultV1 => ({ kind: "unavailable", reasonCode });

const parseCanonicalDecimalSafe = (
  value: string | undefined,
): CanonicalDecimalValueV1 | undefined => {
  if (value === undefined) return undefined;
  try {
    return parseCanonicalDecimal(value);
  } catch {
    return undefined;
  }
};

const absoluteValue = (value: CanonicalDecimalValueV1): CanonicalDecimalValueV1 =>
  value.units < 0n ? { units: -value.units, scale: value.scale } : value;

/** 规范十进制值按六位小数 half-away-from-zero 规范化；超出可表示范围返回 `undefined`。 */
const canonicalAtDeviationScale = (value: CanonicalDecimalValueV1): string | undefined => {
  try {
    return canonicalDecimalToString(
      roundCanonicalDecimalValue(value, RESPONSE_DEVIATION_MAX_SCALE_V1),
    );
  } catch {
    return undefined;
  }
};

/** 整数域除法并按六位小数 half-away-from-zero 规范化；分母必须为正。 */
const divideToDeviationScale = (
  numerator: CanonicalDecimalValueV1,
  denominator: CanonicalDecimalValueV1,
): CanonicalDecimalValueV1 | undefined => {
  if (denominator.units <= 0n) return undefined;
  const absNumerator = numerator.units < 0n ? -numerator.units : numerator.units;
  const scaledNumerator =
    absNumerator * 10n ** BigInt(denominator.scale + RESPONSE_DEVIATION_MAX_SCALE_V1);
  const scaledDenominator = denominator.units * 10n ** BigInt(numerator.scale);
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const rounded = remainder * 2n >= scaledDenominator ? quotient + 1n : quotient;
  return {
    units: numerator.units < 0n ? -rounded : rounded,
    scale: RESPONSE_DEVIATION_MAX_SCALE_V1,
  };
};

const ordinalOf = (
  riskLevelOrdinals: ReadonlyMap<string, number>,
  riskLevelId: string,
): number | undefined => {
  const ordinal = riskLevelOrdinals.get(riskLevelId);
  return ordinal === undefined || !Number.isSafeInteger(ordinal) || ordinal <= 0
    ? undefined
    : ordinal;
};

/**
 * D-07 确定性偏差计算：三种策略各自唯一，阈值相等视为未超过。
 * relative 的越限判定先做整数交叉乘法比较，不先做除法。
 */
export const computeResponseDeviation = (
  input: ResponseDeviationInputV1,
): ResponseDeviationComputationResultV1 => {
  const predicted = parseCanonicalDecimalSafe(input.predictedValue);
  if (predicted === undefined) return unavailable("value-not-numeric");
  if (!Number.isFinite(input.actualValue)) return unavailable("value-not-numeric");
  if (input.unit !== input.actualUnit) return unavailable("unit-mismatch");
  const actual = decimalFromFiniteNumber(input.actualValue);
  const comparison = compareCanonicalDecimalValues(actual, predicted);
  const direction: ResponseDeviationDirectionV1 =
    comparison > 0 ? "actual-above" : comparison < 0 ? "actual-below" : "equal";
  const absDelta = absoluteValue(
    addCanonicalDecimalValues(actual, { units: -predicted.units, scale: predicted.scale }),
  );

  switch (input.basis) {
    case "absolute": {
      const threshold = parseCanonicalDecimalSafe(input.threshold);
      if (threshold === undefined || threshold.units < 0n) {
        return unavailable("basis-incompatible");
      }
      const value = canonicalAtDeviationScale(absDelta);
      if (value === undefined) return unavailable("basis-incompatible");
      return {
        kind: "computed",
        computation: {
          basis: "absolute",
          deviationValue: value,
          deviationValueNumber: Number(value),
          thresholdExceeded: compareCanonicalDecimalValues(absDelta, threshold) > 0,
          direction,
        },
      };
    }
    case "relative": {
      const threshold = parseCanonicalDecimalSafe(input.threshold);
      const minimumBaseline = parseCanonicalDecimalSafe(input.minimumBaseline);
      if (threshold === undefined || minimumBaseline === undefined) {
        return unavailable("basis-incompatible");
      }
      if (threshold.units < 0n || minimumBaseline.units <= 0n) {
        return unavailable("basis-incompatible");
      }
      const denominator =
        compareCanonicalDecimalValues(absoluteValue(predicted), minimumBaseline) >= 0
          ? absoluteValue(predicted)
          : minimumBaseline;
      if (denominator.units <= 0n) return unavailable("basis-incompatible");
      const value = divideToDeviationScale(absDelta, denominator);
      if (value === undefined) return unavailable("basis-incompatible");
      const canonical = canonicalDecimalToString(value);
      // 越限判定用整数交叉乘法：absDelta > threshold × denominator。
      const limit: CanonicalDecimalValueV1 = {
        units: threshold.units * denominator.units,
        scale: threshold.scale + denominator.scale,
      };
      return {
        kind: "computed",
        computation: {
          basis: "relative",
          deviationValue: canonical,
          deviationValueNumber: Number(canonical),
          thresholdExceeded: compareCanonicalDecimalValues(absDelta, limit) > 0,
          direction,
        },
      };
    }
    case "risk-level-step": {
      if (input.levelStep === undefined) return unavailable("basis-incompatible");
      const predictedOrdinal = ordinalOf(
        input.riskLevelOrdinals,
        input.predictedRiskState.riskLevel,
      );
      const actualOrdinal = ordinalOf(input.riskLevelOrdinals, input.actualRiskState.riskLevel);
      if (predictedOrdinal === undefined || actualOrdinal === undefined) {
        return unavailable("risk-level-ordinal-missing");
      }
      const step = Math.abs(actualOrdinal - predictedOrdinal);
      return {
        kind: "computed",
        computation: {
          basis: "risk-level-step",
          deviationValue: String(step),
          deviationValueNumber: step,
          thresholdExceeded: step > input.levelStep,
          direction,
        },
      };
    }
  }
};

/* -------------------------------------------------------------------------- */
/* D-05：执行器结果复验（回显必须逐项一致）                                     */
/* -------------------------------------------------------------------------- */

export const RESPONSE_FORECAST_RESULT_INVALID_REASONS_V1 = [
  "result-unreadable",
  "method-mismatch",
  "required-ref-mismatch",
  "target-indicator-mismatch",
  "unit-mismatch",
  "horizon-mismatch",
  "risk-state-invalid",
] as const;
export type ResponseForecastResultInvalidReasonV1 =
  (typeof RESPONSE_FORECAST_RESULT_INVALID_REASONS_V1)[number];

export type ResponseForecastExecutionV1 =
  | { readonly kind: "executed"; readonly result: ResponseForecastExecutorResultV1 }
  | { readonly kind: "invalid"; readonly reasonCode: ResponseForecastResultInvalidReasonV1 };

const invalidResult = (
  reasonCode: ResponseForecastResultInvalidReasonV1,
): ResponseForecastExecutionV1 => ({ kind: "invalid", reasonCode });

/**
 * 执行器必须回显完全相同的 method、`requiredRef`、目标指标、单位、时域，
 * 并给出规范预测值、合法风险状态与非空证据；任一不符即失败闭合，不换方法或补默认值。
 */
export const verifyForecastExecutorResult = (input: {
  readonly method: string;
  readonly requiredRef: VersionReference;
  readonly targetIndicatorId: string;
  readonly unit: string;
  readonly horizonSteps: number;
  readonly riskLevelIds: readonly string[];
  readonly result: unknown;
}): ResponseForecastExecutionV1 => {
  const parsed = ResponseForecastExecutorResultV1Schema.safeParse(input.result);
  if (!parsed.success) return invalidResult("result-unreadable");
  const result = parsed.data;
  if (result.method !== input.method) return invalidResult("method-mismatch");
  if (
    result.requiredRef.entityId !== input.requiredRef.entityId ||
    result.requiredRef.versionId !== input.requiredRef.versionId
  ) {
    return invalidResult("required-ref-mismatch");
  }
  if (result.targetIndicatorId !== input.targetIndicatorId) {
    return invalidResult("target-indicator-mismatch");
  }
  if (result.unit !== input.unit) return invalidResult("unit-mismatch");
  if (result.horizonSteps !== input.horizonSteps) return invalidResult("horizon-mismatch");
  // 风险等级必须存在于同一冻结风险矩阵，strict Schema 不能表达该关系。
  if (!input.riskLevelIds.includes(result.predictedRiskState.riskLevel)) {
    return invalidResult("risk-state-invalid");
  }
  return { kind: "executed", result };
};

/* -------------------------------------------------------------------------- */
/* 稳定身份：同一冻结输入对应同一逻辑结果                                        */
/* -------------------------------------------------------------------------- */

export const responseForecastInputDigest = (input: {
  readonly projectId: string;
  readonly forecastInputSnapshotRef: VersionReference;
  readonly responseRecommendationRef: VersionReference;
  readonly routeDecisionRef: VersionReference;
  readonly frozenAssessmentBasisRef: VersionReference;
  readonly preActionMonitoringSnapshotRef: VersionReference;
  readonly forecastPolicyRef: VersionReference;
  readonly requiredRef: VersionReference;
  readonly method: string;
  readonly targetIndicatorId: string;
  readonly unit: string;
  readonly horizonSteps: number;
}): string => sha256CanonicalJson(input);

export const effectForecastRefOf = (inputDigest: string): EffectForecastRefV1 => ({
  kind: "effect-forecast",
  reference: { entityId: `effect-forecast-${inputDigest.slice(0, 32)}`, versionId: "1" },
});

export const responseExecutionDigest = (input: {
  readonly projectId: string;
  readonly source: unknown;
  readonly executedByActorId: string;
  readonly recordedByActorId: string;
  readonly occurredAt: string;
  readonly evidenceReferences: readonly unknown[];
}): string => sha256CanonicalJson(input);

export const executionRecordRefOf = (inputDigest: string): ExecutionRecordRefV1 => ({
  kind: "execution-record",
  reference: { entityId: `execution-record-${inputDigest.slice(0, 32)}`, versionId: "1" },
});

export const responseFeedbackDigest = (input: {
  readonly projectId: string;
  readonly executionRecordRef: VersionReference;
  readonly postActionMonitoringSnapshotRef: VersionReference;
  readonly feedbackArtifactRef: VersionReference;
  readonly actualAssessmentRecordRef: VersionReference;
  readonly occurredAt: string;
}): string => sha256CanonicalJson(input);

export const feedbackRefOf = (inputDigest: string): FeedbackRefV1 => ({
  kind: "feedback",
  reference: { entityId: `feedback-${inputDigest.slice(0, 32)}`, versionId: "1" },
});

export const responseDeviationDigest = (input: {
  readonly projectId: string;
  readonly effectForecastRef: VersionReference;
  readonly feedbackRef: VersionReference;
  readonly deviationPolicyRef: VersionReference;
  readonly basis: string;
}): string => sha256CanonicalJson(input);

export const deviationFactRefOf = (
  inputDigest: string,
): z.infer<typeof ResponseDeviationFactRefV1Schema> =>
  ResponseDeviationFactRefV1Schema.parse({
    kind: "response-deviation-fact",
    reference: { entityId: `response-deviation-${inputDigest.slice(0, 32)}`, versionId: "1" },
  });

/* -------------------------------------------------------------------------- */
/* D-03：精确上下文读取接缝                                                     */
/* -------------------------------------------------------------------------- */

/** 上游冻结事实：C27 正式建议链、C25 基线与输入快照、C19 basis 引用。 */
export interface ResponseLifecycleFrozenContextV1 {
  readonly projectId: string;
  readonly responseRecommendationRef: {
    readonly kind: "response-recommendation";
    readonly reference: VersionReference;
  };
  readonly record: ResponseRecommendation;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly warningRecordRef: WarningRecordRefV1;
  readonly warningResponseTaskRef: WarningResponseTaskRefV1;
  readonly measureLibraryReleaseRef: VersionReference;
  readonly basisReleaseSetRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  };
  readonly riskInputRef: RiskInputVersionRefV1;
  readonly baselineAssessmentRecordRef: RiskAssessmentRecordRefV1;
  readonly baselineAssessmentInputSnapshotRef: AssessmentInputSnapshotRefV1;
  readonly baseline: {
    readonly riskState: RiskState;
    readonly indicatorValues: readonly {
      readonly indicatorItem: string;
      readonly value: string | number | boolean;
    }[];
  };
}

/** C04 正文读取结果：只按成员工件与摘要解析，不复制 C18 表或内联策略。 */
export interface ResponseLifecycleBasisMemberV1 {
  readonly member: {
    readonly definitionType: string;
    readonly releaseRef: { readonly reference: VersionReference };
  };
  readonly content: unknown;
}

/** 执行器输入：冻结快照正文、单个 C18 策略、基线指标/风险状态与 C14 执行前快照。 */
export type { ResponseForecastExecutorRequestV1 } from "./schema.js";

/** C25 评估链的精确投影：记录正文、风险输入、冻结 basis、空间与准备快照的监测引用。 */
export interface ResponseLifecycleAssessmentChainV1 {
  readonly record: RiskAssessmentRecord;
  readonly riskInput: { readonly kind: string; readonly entityId: string };
  readonly inputSnapshotRef: VersionReference;
  readonly basisRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  };
  readonly spatialScopeRef: {
    readonly kind: "spatial-scope";
    readonly reference: VersionReference;
  };
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
  readonly riskState: {
    readonly likelihoodScore: number;
    readonly consequenceScore: number;
    readonly riskLevel: string;
  };
  readonly indicatorValues: readonly {
    readonly indicatorItem: string;
    readonly value: string | number | boolean;
  }[];
}

export interface ResponseLifecycleContextReaderV1 {
  /** 按精确引用读取 C27 建议链与 C25 基线，逐项核对工程/空间/风险输入。 */
  readRecommendationContext(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly responseRecommendationRef: {
      readonly kind: "response-recommendation";
      readonly reference: VersionReference;
    };
  }): Promise<ResponseLifecycleFrozenContextV1>;

  /** 按精确引用读取 C25 实际/基线评估链：反馈与偏差都只消费该投影。 */
  readAssessmentChain(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: VersionReference;
    };
  }): Promise<ResponseLifecycleAssessmentChainV1>;

  /** 按精确引用确认同工程已发布措施：独立行动只接受 C19/C04 拥有的事实。 */
  readPublishedMeasureReleases(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly measureLibraryReleaseRefs: readonly VersionReference[];
  }): Promise<readonly VersionReference[]>;

  /** 按 C25 输入快照解析其冻结 basis 集合引用：偏差读取只消费 C25 已冻结事实。 */
  readBasisReleaseSetRefForInputSnapshot(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1;
  }): Promise<{
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  }>;

  /** 按 C25 冻结 basis 读取 C18 成员工件正文（含摘要对账）。 */
  readBasisMembers(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly basisReleaseSetRef: {
      readonly kind: "assessment-basis-release-set";
      readonly reference: VersionReference;
    };
    readonly definitionTypes: readonly string[];
    readonly policyRef?: VersionReference;
  }): Promise<readonly ResponseLifecycleBasisMemberV1[]>;

  /** C14 精确监测快照：只读取冻结引用，不查 latest、不自行选择序列或 cutoff。 */
  readMonitoringSnapshot(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly monitoringSnapshotRef: MonitoringSnapshotRefV1;
  }): Promise<MonitoringSnapshotV1>;

  /** C04 反馈工件正文：读取失败即类型化拒绝，不落部分反馈。 */
  readFeedbackArtifact(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly feedbackArtifactRef: ContentArtifactRefV1;
  }): Promise<unknown>;
}

/* -------------------------------------------------------------------------- */
/* 用例结果                                                                    */
/* -------------------------------------------------------------------------- */

export const ResponseForecastResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    result: z.strictObject({ outcome: ResponseForecastOutcomeV1Schema }),
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type ResponseForecastResultV1 = z.infer<typeof ResponseForecastResultV1Schema>;

export const ResponseDeviationResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    result: z.strictObject({
      deviationFactRef: ResponseDeviationFactRefV1Schema,
      fact: ResponseDeviationFactV1Schema,
    }),
  }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: z.string().min(1) }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type ResponseDeviationResultV1 = z.infer<typeof ResponseDeviationResultV1Schema>;

export const ResponseDeviationFactReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    result: z.strictObject({ fact: ResponseDeviationFactV1Schema }),
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type ResponseDeviationFactReadResultV1 = z.infer<
  typeof ResponseDeviationFactReadResultV1Schema
>;

/**
 * C28 用例接口：只暴露自己拥有的五个窄用例与 C29 的精确读取，
 * 不复制公共 `record` union，也不以开放 `execute` 分支承接任意动作。
 */
export interface ResponseLifecycleServiceV1 {
  recordDecision(command: unknown): Promise<WarningResponseRecordResultV1>;
  forecastResponse(command: unknown): Promise<ResponseForecastResultV1>;
  recordExecution(command: WarningResponseRecordCommandV1): Promise<WarningResponseRecordResultV1>;
  recordFeedback(command: unknown): Promise<WarningResponseRecordResultV1>;
  calculateDeviation(command: WarningResponseRecordCommandV1): Promise<ResponseDeviationResultV1>;
}

export interface ResponseDeviationFactReaderV1 {
  readDeviationFact(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly deviationFactRef: z.infer<typeof ResponseDeviationFactRefV1Schema>;
  }): Promise<ResponseDeviationFactReadResultV1>;
}
