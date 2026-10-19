/**
 * 总览态势图：评估等级 donut 与工序条形图。
 *
 * 只消费仪表盘读面已给的分组；等级没有正式 ordinal 时用中性色呈现并保留原标识，
 * 不从标识字面量或数组位置猜严重度。每张图都配一份同值的可见表格，键盘可直接读到数值。
 */
import type { EChartsCoreOption } from "echarts/core";

import { ChartSurface } from "../charts/ChartSurface";
import { useChart } from "../charts/useChart";
import { useChartTheme } from "../theme/DesignSystemProvider";
import { presentRiskLevel, RISK_COLOR_UNDEFINED_MESSAGE } from "../theme/riskPresentation";

export interface AssessmentLevelDatum {
  readonly levelId: string;
  readonly count: number;
}

export interface ProcessDatum {
  readonly processNodeId: string;
  readonly count: number;
}

const share = (count: number, total: number): string =>
  total === 0 ? "0%" : `${Math.round((count / total) * 100)}%`;

/** 冻结矩阵的等级分布：只画传入矩阵的等级，多个矩阵不混画。 */
export function AssessmentLevelDonut({
  levels,
  title = "评估等级分布",
}: {
  levels: readonly AssessmentLevelDatum[];
  title?: string;
}) {
  const theme = useChartTheme();
  const total = levels.reduce((sum, level) => sum + level.count, 0);
  const presented = levels.map((level) => ({
    level,
    presentation: presentRiskLevel({ levelId: level.levelId }, theme),
  }));

  const option: EChartsCoreOption = {
    tooltip: { trigger: "item" },
    series: [
      {
        type: "pie",
        radius: ["54%", "78%"],
        data: presented.map(({ level, presentation }) => ({
          name: level.levelId,
          value: level.count,
          itemStyle: {
            color: presentation.background,
            borderColor: theme.border,
            borderWidth: 1,
          },
        })),
        label: { color: theme.text, fontSize: 12, formatter: "{b} {c}" },
        labelLine: { lineStyle: { color: theme.border } },
        emphasis: { scale: false },
      },
    ],
  };
  const ref = useChart(option, [
    JSON.stringify(levels),
    theme.border,
    theme.text,
    theme.neutralSoft,
  ]);

  return (
    <ChartSurface
      title={title}
      status={levels.length === 0 ? "empty" : "ready"}
      emptyMessage="当前冻结矩阵暂无评估记录"
    >
      <div className="ov-donut-layout">
        <div
          ref={ref}
          style={{ height: 200, width: "100%" }}
          role="img"
          aria-label={`${title}：${presented
            .map(({ level, presentation }) => `${presentation.label} ${level.count}`)
            .join("，")}`}
        />
        <table className="data-table ov-chart-alt">
          <caption className="ov-chart-caption">同一数据的文字替代。</caption>
          <thead>
            <tr>
              <th>风险等级</th>
              <th>记录数</th>
              <th>占比</th>
            </tr>
          </thead>
          <tbody>
            {presented.map(({ level, presentation }) => (
              <tr key={level.levelId}>
                <td>
                  {presentation.label}
                  {presentation.mapped ? null : `（${RISK_COLOR_UNDEFINED_MESSAGE}）`}
                </td>
                <td className="mono">{level.count}</td>
                <td className="mono">{share(level.count, total)}</td>
              </tr>
            ))}
            <tr>
              <td>合计</td>
              <td className="mono">{total}</td>
              <td className="mono">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ChartSurface>
  );
}

/** 工序风险记录分布：类别就是真实 processNodeId，不拼原型工序表。 */
export function ProcessDistributionBars({
  processes,
  title = "工序风险记录分布",
}: {
  processes: readonly ProcessDatum[];
  title?: string;
}) {
  const theme = useChartTheme();
  // 计数倒序便于阅读；同值按标识排序，结果与输入顺序无关。
  const sorted = [...processes].sort(
    (left, right) =>
      right.count - left.count || left.processNodeId.localeCompare(right.processNodeId),
  );
  const height = Math.max(160, sorted.length * 28 + 40);

  const option: EChartsCoreOption = {
    grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: theme.neutralSoft } },
      axisLabel: { color: theme.textSecondary, fontSize: 12 },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: sorted.map((entry) => entry.processNodeId),
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 12 },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((entry) => entry.count),
        barMaxWidth: 18,
        itemStyle: { color: theme.primary, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", color: theme.text, fontSize: 12 },
      },
    ],
  };
  const ref = useChart(option, [
    JSON.stringify(sorted),
    height,
    theme.primary,
    theme.border,
    theme.neutralSoft,
    theme.text,
    theme.textSecondary,
  ]);

  return (
    <ChartSurface
      title={title}
      status={sorted.length === 0 ? "empty" : "ready"}
      emptyMessage="当前统计范围内没有可归入工序的风险记录版本"
    >
      <div className="ov-donut-layout">
        <div
          ref={ref}
          style={{ height, width: "100%" }}
          role="img"
          aria-label={`${title}：${sorted
            .map((entry) => `${entry.processNodeId} ${entry.count}`)
            .join("，")}`}
        />
        <table className="data-table ov-chart-alt">
          <caption className="ov-chart-caption">同一数据的文字替代。</caption>
          <thead>
            <tr>
              <th>工序</th>
              <th>记录版本数</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr key={entry.processNodeId}>
                <td className="mono">{entry.processNodeId}</td>
                <td className="mono">{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartSurface>
  );
}
