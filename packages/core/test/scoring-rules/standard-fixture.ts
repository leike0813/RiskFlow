/**
 * GB 50911-2013《城市轨道交通工程监测技术规范》真实规范夹具（core/adapter 共用）。
 *
 * 数据源：`./fixtures/gb50911-2013-clauses.json`（条文、指标项、控制值与例外条款）；
 * 来源、章节号→PDF 页码、sha256 与许可见 `./fixtures/gb50911-2013-clauses.source.json`
 * 与 `references/client-inputs/c19-specs/MANIFEST.md`。
 *
 * 真实公开来源（非甲方审核资料）；甲方正式输入到位后需复核。
 */
import type { GradeInterval, ScoringThreshold } from "@riskflow/contracts/records";

import clauseFixture from "./fixtures/gb50911-2013-clauses.json" with { type: "json" };
import sourceMetadata from "./fixtures/gb50911-2013-clauses.source.json" with { type: "json" };

export const GB50911_FIXTURE = clauseFixture;
export const GB50911_SOURCE_METADATA = sourceMetadata;

export const GB50911_STANDARD = clauseFixture.standard;
export const GB50911_CLAUSES = clauseFixture.clauses;
export const GB50911_INDICATOR_ITEMS = clauseFixture.indicatorItems;
export const GB50911_CONTROL_VALUES = clauseFixture.controlValues[0]!;
export const GB50911_BANDS = GB50911_CONTROL_VALUES.bands;
export const GB50911_EXCEPTIONS = clauseFixture.exceptions;
export const GB50911_SOFT_SOIL_BANDS = GB50911_BANDS.filter(
  (band) => band.stratumCondition === "中软~软弱土",
);
export const GB50911_STIFF_SOIL_BANDS = GB50911_BANDS.filter(
  (band) => band.stratumCondition === "坚硬~中硬土",
);

/** 夹具登记的规范来源版本：标准号 + 实施日期，与 PDF 页眉、公告一致。 */
export const GB50911_SOURCE_VERSION_REF = {
  kind: "source-version",
  reference: { entityId: GB50911_STANDARD.code, versionId: GB50911_STANDARD.effectiveFrom },
} as const;

/**
 * 资料段定位：`<标准号>/<条文号>[/<表号>]`，与 C15 转换后的段定位语义一致，
 * 让规则证据可以反查到具体章节号。
 */
export const gb50911SegmentId = (clauseNumber: string, tableNumber?: string): string =>
  tableNumber === undefined
    ? `${GB50911_STANDARD.code}/${clauseNumber}`
    : `${GB50911_STANDARD.code}/${clauseNumber}/${tableNumber}`;

export const GB50911_CLAUSE_SEGMENT_ID = {
  mandatoryMonitoring: gb50911SegmentId("3.1.1"),
  indicatorItems: gb50911SegmentId("4.2.2", "表 4.2.2"),
  controlValues: gb50911SegmentId("9.2.2", GB50911_CONTROL_VALUES.tableNumber),
  mandatoryWarning: gb50911SegmentId("9.1.5"),
} as const;

export const GB50911_CONTROL_LIMIT_EXCEEDED_GRADE_ID = "gb50911-control-limit-exceeded";

/**
 * 由表中「工程监测等级」行直接派生评分阈值：等级区间左闭右开，最后一个阈值覆盖超出表中
 * 最大控制值的情形（9.1.5 强制性条文要求达到预警标准即报送警情）。
 */
export const gb50911ScoringThresholds = (
  bands: typeof GB50911_BANDS,
): readonly ScoringThreshold[] => [
  ...bands.map((band, index) => ({
    thresholdId: `${band.gradeId}-cumulative`,
    score: index + 1,
    operator: "between" as const,
    value: band.cumulative[0],
    upperValue: band.cumulative[1],
  })),
  {
    thresholdId: "gb50911-over-control-value",
    score: 5,
    operator: "gte" as const,
    value: Math.max(...bands.map((band) => band.cumulative[1])),
  },
];

export const gb50911GradeIntervals = (bands: typeof GB50911_BANDS): readonly GradeInterval[] => [
  { grade: bands[0]!.gradeId, upperBound: bands[0]!.cumulative[1] },
  ...bands.map((band, index) =>
    index === bands.length - 1
      ? { grade: GB50911_CONTROL_LIMIT_EXCEEDED_GRADE_ID, lowerBound: band.cumulative[1] }
      : {
          grade: bands[index + 1]!.gradeId,
          lowerBound: band.cumulative[1],
          upperBound: bands[index + 1]!.cumulative[1],
        },
  ),
];
