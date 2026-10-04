import { describe, expect, it } from "vitest";

import { divideDecimals, decimalFromInteger } from "../../src/risk-assessment/engine/decimal.js";
import {
  computeEffectForecast,
  EffectForecastModelArtifactV1Schema,
  EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1,
  type ForecastAlignedPointV1,
} from "../../src/response-lifecycle/index.js";

/**
 * 三类生产参数预测算法的验收样本。模型参数、阈值与措施效果都是本用例显式声明的合成值，
 * 代表"合成样本、待甲方复核"，不代表真实模型推理质量或甲方正式规则已经交付。
 */

const EVIDENCE = [
  {
    locator: { sourceSegmentId: "forecast-sample-segment" },
    sourceVersion: { entityId: "source-version-synthetic", versionId: "1" },
  },
];

const modelBase = {
  schemaVersion: "1" as const,
  projectId: "forecast-project",
  algorithmVersion: EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1,
  stepMs: 1000,
  maxHorizonSteps: 720,
  calculationScale: 2,
  measureLibraryReleaseRef: { entityId: "measure-library-synthetic", versionId: "1" },
  measureEffects: [{ measureId: "measure-1", offset: "0", perStep: "0" }],
  evidenceReferences: EVIDENCE,
  sampleOrigin: "synthetic" as const,
  reviewStatus: "pending-client-review" as const,
};

const historicalModel = (
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  ...modelBase,
  method: "historical-statistics",
  inputIndicators: [
    { indicatorId: "input-a", unit: "mm" },
    { indicatorId: "input-b", unit: "1" },
  ],
  targetIndicatorId: "target-1",
  unit: "mm",
  parameters: {
    intercept: "10",
    inputCoefficients: [{ coefficient: "2" }, { coefficient: "0.5" }],
    horizonCoefficient: "0.25",
    fitSampleCount: 240,
  },
  ...overrides,
});

const trendModel = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  ...modelBase,
  method: "monitoring-trend",
  inputIndicators: [{ indicatorId: "target-1", unit: "mm" }],
  targetIndicatorId: "target-1",
  unit: "mm",
  parameters: { windowPoints: 5 },
  ...overrides,
});

const mechanismModel = (
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  ...modelBase,
  method: "mechanism-model",
  inputIndicators: [{ indicatorId: "input-a", unit: "mm" }],
  targetIndicatorId: "target-1",
  unit: "mm",
  parameters: {
    intercept: "0",
    terms: [
      { indicatorId: "input-a", power: 1, coefficient: "2" },
      { indicatorId: "input-a", power: 2, coefficient: "0.5" },
    ],
    horizonCoefficient: "1",
    inputDomains: [{ indicatorId: "input-a", domain: { lower: "0", upper: "10" } }],
    outputDomain: { lower: "-100", upper: "100" },
  },
  ...overrides,
});

const aligned = (
  values: readonly (number | null)[],
  overrides: Partial<ForecastAlignedPointV1> = {},
): readonly ForecastAlignedPointV1[] =>
  values.map((value, index) => ({
    sampledAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString(),
    value,
    unit: "mm",
    status: value === null ? ("missing" as const) : ("available" as const),
    ...overrides,
  }));

const CUTOFF = new Date(Date.UTC(2030, 0, 1, 0, 0, 4)).toISOString();

describe("C28 参数预测模型工件契约", () => {
  it("三种方法的合成模型都满足所属 Schema", () => {
    for (const model of [historicalModel(), trendModel(), mechanismModel()]) {
      expect(EffectForecastModelArtifactV1Schema.safeParse(model).success).toBe(true);
    }
  });

  it("历史统计按输入位置保留重复系数，并允许目标指标作为显式输入", () => {
    const model = historicalModel({
      inputIndicators: [
        { indicatorId: "input-a", unit: "mm" },
        { indicatorId: "target-1", unit: "mm" },
      ],
      parameters: {
        intercept: "10",
        inputCoefficients: [{ coefficient: "2" }, { coefficient: "2" }],
        horizonCoefficient: "0.25",
        fitSampleCount: 240,
      },
    });
    expect(EffectForecastModelArtifactV1Schema.safeParse(model).success).toBe(true);
  });

  it("缺参数、错方法形状与越界预算都不构成合法模型", () => {
    const invalid: readonly unknown[] = [
      // 系数数量与声明输入不一一对应。
      historicalModel({
        parameters: {
          intercept: "10",
          inputCoefficients: [{ coefficient: "2" }],
          horizonCoefficient: "0.25",
          fitSampleCount: 240,
        },
      }),
      // 趋势方法必须只以目标指标为输入。
      trendModel({
        inputIndicators: [
          { indicatorId: "target-1", unit: "mm" },
          { indicatorId: "input-a", unit: "mm" },
        ],
      }),
      // 机理项超出声明输入集合，且没有对应输入区间。
      mechanismModel({
        parameters: {
          intercept: "0",
          terms: [{ indicatorId: "input-z", power: 1, coefficient: "1" }],
          horizonCoefficient: "1",
          inputDomains: [{ indicatorId: "input-a", domain: { lower: "0", upper: "10" } }],
          outputDomain: { lower: "0", upper: "10" },
        },
      }),
      // 区间下界大于上界。
      mechanismModel({
        parameters: {
          intercept: "0",
          terms: [{ indicatorId: "input-a", power: 1, coefficient: "1" }],
          horizonCoefficient: "1",
          inputDomains: [{ indicatorId: "input-a", domain: { lower: "10", upper: "0" } }],
          outputDomain: { lower: "0", upper: "10" },
        },
      }),
      // 时域超预算。
      mechanismModel({ maxHorizonSteps: 0 }),
      // 合成样本不得表述为已审核。
      mechanismModel({ reviewStatus: "reviewed" }),
    ];
    for (const model of invalid) {
      expect(
        EffectForecastModelArtifactV1Schema.safeParse(model).success,
        JSON.stringify(model),
      ).toBe(false);
    }
  });

  it("甲方复核样本必须已审核，合成样本不得冒充", () => {
    expect(
      EffectForecastModelArtifactV1Schema.safeParse({
        ...mechanismModel(),
        sampleOrigin: "client-reviewed",
        reviewStatus: "pending-client-review",
      }).success,
    ).toBe(false);
    expect(
      EffectForecastModelArtifactV1Schema.safeParse({
        ...mechanismModel(),
        sampleOrigin: "client-reviewed",
        reviewStatus: "reviewed",
      }).success,
    ).toBe(true);
  });
});

describe("C28 规范十进制除法", () => {
  it("按有界 scale 精确相除并 half-away-from-zero 就近", () => {
    const one = decimalFromInteger(1);
    const three = decimalFromInteger(3);
    // 1/3 在 6 位小数上是循环近似，按 scale 就近而不是无限逼近。
    expect(divideDecimals(one, three, 6)).toEqual({ units: 333333n, scale: 6 });
    expect(divideDecimals(decimalFromInteger(2), three, 4)).toEqual({ units: 6667n, scale: 4 });
    // 精确整除不引入多余小数位。
    expect(divideDecimals(decimalFromInteger(12), decimalFromInteger(4), 6)).toEqual({
      units: 3000000n,
      scale: 6,
    });
    // 负数同样按绝对值就近，符号跟随被除数。
    expect(divideDecimals(decimalFromInteger(-1), three, 4)).toEqual({ units: -3333n, scale: 4 });
  });

  it("分母为零没有定义，直接失败而不是回退成零", () => {
    expect(() => divideDecimals(decimalFromInteger(1), decimalFromInteger(0), 6)).toThrow();
  });
});

describe("C28 历史统计参数预测", () => {
  const baseline = [
    { indicatorId: "input-a", value: "3" },
    { indicatorId: "input-b", value: "10" },
  ];

  it("按声明的回归系数代入基线并叠加正式措施效果", () => {
    // ŷ = 10 + 2×3 + 0.5×10 + 0.25×4 = 22；E = −1 + 0.5×4 = 1。
    const result = computeEffectForecast({
      method: "historical-statistics",
      model: historicalModel({
        measureEffects: [{ measureId: "measure-1", offset: "-1", perStep: "0.5" }],
      }),
      horizonSteps: 4,
      baselineValues: baseline,
      measures: [{ measureId: "measure-1", offset: "-1", perStep: "0.5" }],
    });
    expect(result).toEqual({ kind: "value", value: "23" });
  });

  it("时域与措施只通过声明参数影响结果，同输入可逐字符重放", () => {
    const request = {
      method: "historical-statistics",
      model: historicalModel({
        measureEffects: [{ measureId: "measure-1", offset: "0", perStep: "1" }],
      }),
      horizonSteps: 2,
      baselineValues: baseline,
      measures: [{ measureId: "measure-1", offset: "0", perStep: "1" }],
    } as const;
    // ŷ = 10 + 6 + 5 + 0.5 = 21.5；E = 2。
    expect(computeEffectForecast(request)).toEqual({ kind: "value", value: "23.5" });
    expect(computeEffectForecast(request)).toEqual(computeEffectForecast(request));
  });

  it("缺输入、越界时域、未声明措施与非法工件按受控结果收敛", () => {
    const cases: readonly (readonly [string, unknown])[] = [
      [
        "input-indicator-missing",
        computeEffectForecast({
          method: "historical-statistics",
          model: historicalModel(),
          horizonSteps: 4,
          baselineValues: [{ indicatorId: "input-a", value: "3" }],
          measures: [],
        }),
      ],
      [
        "horizon-out-of-range",
        computeEffectForecast({
          method: "historical-statistics",
          model: historicalModel({ maxHorizonSteps: 3 }),
          horizonSteps: 4,
          baselineValues: baseline,
          measures: [],
        }),
      ],
      [
        "measure-unsupported",
        computeEffectForecast({
          method: "historical-statistics",
          model: historicalModel(),
          horizonSteps: 4,
          baselineValues: baseline,
          measures: [{ measureId: "measure-unknown", offset: "0", perStep: "0" }],
        }),
      ],
      [
        "model-unreadable",
        computeEffectForecast({
          method: "historical-statistics",
          model: { method: "historical-statistics" },
          horizonSteps: 4,
          baselineValues: baseline,
          measures: [],
        }),
      ],
      [
        "method-mismatch",
        computeEffectForecast({
          method: "mechanism-model",
          model: historicalModel(),
          horizonSteps: 4,
          baselineValues: baseline,
          measures: [],
        }),
      ],
    ];
    for (const [reason, result] of cases) {
      expect(result, reason).toMatchObject({ kind: expect.stringMatching(/unavailable|rejected/) });
      expect(result, reason).toHaveProperty("reason", reason);
      expect(result, reason).not.toHaveProperty("value");
    }
  });

  it("布尔与非数值字符串不被强转为数值输入", () => {
    const result = computeEffectForecast({
      method: "historical-statistics",
      model: historicalModel(),
      horizonSteps: 4,
      baselineValues: [
        { indicatorId: "input-a", value: "true" },
        { indicatorId: "input-b", value: "不是数字" },
      ],
      measures: [],
    });
    expect(result).toEqual({ kind: "unavailable", reason: "input-indicator-missing" });
  });
});

describe("C28 监测趋势参数预测", () => {
  it("在声明窗口内按原对齐槽下标做最小二乘外推", () => {
    // 完全线性的 y = x + 1：slope=1、截距=1，外推到 x=4+2=6 得 7；E = 0.5×2 = 1。
    const result = computeEffectForecast({
      method: "monitoring-trend",
      model: trendModel({
        measureEffects: [{ measureId: "measure-1", offset: "0", perStep: "0.5" }],
      }),
      horizonSteps: 2,
      cutoff: CUTOFF,
      alignedPoints: aligned([1, 2, 3, 4, 5]),
      measures: [{ measureId: "measure-1", offset: "0", perStep: "0.5" }],
    });
    expect(result).toEqual({ kind: "value", value: "8" });
  });

  it("缺槽不压缩也不插值，原下标真实拉开横轴距离", () => {
    // 序列在第 3 槽有一个偏离直线的点：稠密窗口把它算进拟合，缺槽窗口直接丢弃它。
    const dense = computeEffectForecast({
      method: "monitoring-trend",
      model: trendModel(),
      horizonSteps: 2,
      cutoff: CUTOFF,
      alignedPoints: aligned([1, 2, 9, 4, 5]),
      measures: [],
    });
    const gapped = computeEffectForecast({
      method: "monitoring-trend",
      model: trendModel(),
      horizonSteps: 2,
      cutoff: CUTOFF,
      alignedPoints: aligned([1, 2, null, 4, 5]),
      measures: [],
    });
    expect(dense).toEqual({ kind: "value", value: "8.2" });
    expect(gapped).toEqual({ kind: "value", value: "7" });
    // 若把缺槽压缩掉重新编号下标，两次拟合会给出同一个结果；这里它们不同。
    expect(gapped).not.toEqual(dense);
  });

  it("样本不足、槽不对齐与同窗口外的单位都不参与拟合", () => {
    expect(
      computeEffectForecast({
        method: "monitoring-trend",
        model: trendModel(),
        horizonSteps: 2,
        cutoff: CUTOFF,
        alignedPoints: aligned([1, null, null, null, null]),
        measures: [],
      }),
    ).toEqual({ kind: "unavailable", reason: "monitoring-window-insufficient" });
    expect(
      computeEffectForecast({
        method: "monitoring-trend",
        model: trendModel(),
        horizonSteps: 2,
        cutoff: CUTOFF,
        // 步长声明为 1000ms，但槽时间不在截止时刻的步长网格上。
        alignedPoints: aligned([1, 2, 3, 4, 5]).map((point, index) => ({
          ...point,
          sampledAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index) + 300).toISOString(),
        })),
        measures: [],
      }),
    ).toEqual({ kind: "unavailable", reason: "monitoring-window-insufficient" });
    expect(
      computeEffectForecast({
        method: "monitoring-trend",
        model: trendModel(),
        horizonSteps: 2,
        cutoff: CUTOFF,
        alignedPoints: aligned([1, 2, 3, 4, 5], { unit: "cm" }),
        measures: [],
      }),
    ).toEqual({ kind: "unavailable", reason: "monitoring-window-insufficient" });
  });

  it("720 槽有界窗口与普通窗口走同一算法（附带测量，不设绝对耗时门禁）", () => {
    const slotCount = 720;
    // 序列在中段换斜率：窗口宽度因此是真实算法输入，稠密窗口与末尾窗口拟合不同。
    const points = Array.from({ length: slotCount }, (_unused, index) => ({
      sampledAt: new Date(Date.UTC(2030, 0, 1, 0, 0, 0) + index * 1000).toISOString(),
      value: index < 360 ? index / 10 : index / 20,
      unit: "mm",
      status: "available" as const,
    }));
    const cutoff = new Date(Date.UTC(2030, 0, 1, 0, 0, slotCount - 1)).toISOString();
    const started = performance.now();
    const wide = computeEffectForecast({
      method: "monitoring-trend",
      model: trendModel({ parameters: { windowPoints: slotCount } }),
      horizonSteps: 10,
      cutoff,
      alignedPoints: points,
      measures: [],
    });
    const elapsedMs = performance.now() - started;
    expect(wide.kind).toBe("value");
    // 末尾 5 槽都在第二段，斜率 0.05、截距 0：x = 719 + 10 = 729 时预测 36.45。
    const narrow = computeEffectForecast({
      method: "monitoring-trend",
      model: trendModel({ parameters: { windowPoints: 5 } }),
      horizonSteps: 10,
      cutoff,
      alignedPoints: points,
      measures: [],
    });
    expect(narrow).toEqual({ kind: "value", value: "36.45" });
    expect(narrow).not.toEqual(wide);
    console.info(`[forecast] 720 槽有界窗口耗时 ${elapsedMs.toFixed(3)}ms`);
  });
});

describe("C28 机理参数预测", () => {
  it("按声明的有界多项式项逐项求和并叠加时域与措施", () => {
    // ŷ = 0 + 2×3 + 0.5×3² + 1×2 = 12.5；E = 0。
    const result = computeEffectForecast({
      method: "mechanism-model",
      model: mechanismModel(),
      horizonSteps: 2,
      baselineValues: [{ indicatorId: "input-a", value: "3" }],
      measures: [],
    });
    expect(result).toEqual({ kind: "value", value: "12.5" });
  });

  it("三次项按声明次数计算，系数与次数都来自模型", () => {
    const result = computeEffectForecast({
      method: "mechanism-model",
      model: mechanismModel({
        parameters: {
          intercept: "1",
          terms: [
            { indicatorId: "input-a", power: 1, coefficient: "1" },
            { indicatorId: "input-a", power: 3, coefficient: "0.1" },
          ],
          horizonCoefficient: "0",
          inputDomains: [{ indicatorId: "input-a", domain: { lower: "0", upper: "10" } }],
          outputDomain: { lower: "0", upper: "100" },
        },
      }),
      horizonSteps: 0 + 1,
      baselineValues: [{ indicatorId: "input-a", value: "2" }],
      measures: [],
    });
    // 1 + 1×2 + 0.1×2³ = 3.8
    expect(result).toEqual({ kind: "value", value: "3.8" });
  });

  it("输入或结果越出声明物理区间时关闭失败，不夹取隐藏非法结果", () => {
    expect(
      computeEffectForecast({
        method: "mechanism-model",
        model: mechanismModel(),
        horizonSteps: 2,
        baselineValues: [{ indicatorId: "input-a", value: "20" }],
        measures: [],
      }),
    ).toEqual({ kind: "rejected", reason: "input-out-of-domain" });
    expect(
      computeEffectForecast({
        method: "mechanism-model",
        model: mechanismModel({
          parameters: {
            intercept: "0",
            terms: [{ indicatorId: "input-a", power: 1, coefficient: "50" }],
            horizonCoefficient: "0",
            inputDomains: [{ indicatorId: "input-a", domain: { lower: "0", upper: "10" } }],
            outputDomain: { lower: "0", upper: "10" },
          },
        }),
        horizonSteps: 1,
        baselineValues: [{ indicatorId: "input-a", value: "3" }],
        measures: [],
      }),
    ).toEqual({ kind: "rejected", reason: "result-out-of-domain" });
  });

  it("缺机理输入时不可用，不回退到其它方法", () => {
    expect(
      computeEffectForecast({
        method: "mechanism-model",
        model: mechanismModel(),
        horizonSteps: 2,
        baselineValues: [],
        measures: [],
      }),
    ).toEqual({ kind: "unavailable", reason: "input-indicator-missing" });
  });
});

describe("C28 预测结果的规范十进制输出", () => {
  it("按模型 calculationScale half-away-from-zero 就近，负数同样远离零", () => {
    // 系数 2 作用于 0.25 得 0.5：scale 1 时恰好落在就近边界上，符号跟随被预测量。
    const linearModel = mechanismModel({
      calculationScale: 1,
      parameters: {
        intercept: "0",
        terms: [{ indicatorId: "input-a", power: 1, coefficient: "2" }],
        horizonCoefficient: "0",
        inputDomains: [{ indicatorId: "input-a", domain: { lower: "-10", upper: "10" } }],
        outputDomain: { lower: "-100", upper: "100" },
      },
    });
    const predicted = (value: string) =>
      computeEffectForecast({
        method: "mechanism-model",
        model: linearModel,
        horizonSteps: 1,
        baselineValues: [{ indicatorId: "input-a", value }],
        measures: [],
      });
    expect(predicted("0.25")).toEqual({ kind: "value", value: "0.5" });
    expect(predicted("-0.25")).toEqual({ kind: "value", value: "-0.5" });
  });
});
