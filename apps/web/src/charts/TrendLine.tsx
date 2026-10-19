import { useChart } from "./useChart";
import { useChartTheme } from "../theme/DesignSystemProvider";
import type { EChartsCoreOption } from "echarts/core";

/**
 * 趋势折线：工程蓝折线 + 可选风险红阈值虚线 + 末点标注（越限时附"已越限"）。
 * 颜色取自入口 Provider 解析出的实际色值——Canvas 不认 var()，不能把 CSS 变量
 * 字面量交给 ECharts。阈值语义沿用既有正式预警边界，此处不重新判定等级。
 */
export function TrendLine({
  points,
  threshold,
  thresholdLabel,
  height,
}: {
  points: { date: string; value: number }[];
  threshold?: number;
  thresholdLabel?: string;
  height: number;
}) {
  const theme = useChartTheme();
  const values = points.map((p) => p.value).filter((value) => Number.isFinite(value));
  const last = [...points].reverse().find((point) => Number.isFinite(point.value));
  const hasThreshold = threshold !== undefined && Number.isFinite(threshold);
  const exceeded = hasThreshold && last !== undefined && last.value >= threshold;
  const extent = hasThreshold ? [...values, threshold] : values;
  const max = extent.length > 0 ? Math.max(...extent) : 1;
  const min = extent.length > 0 ? Math.min(...extent) : 0;

  const option: EChartsCoreOption = {
    grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: points.map((p) => p.date),
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { color: theme.textSecondary, fontSize: 12 },
    },
    yAxis: {
      type: "value",
      min: Math.floor(min * 0.9 * 10) / 10,
      max: Math.ceil(max * 1.08 * 10) / 10,
      splitLine: { lineStyle: { color: theme.neutralSoft } },
      axisLabel: { color: theme.textSecondary, fontSize: 12 },
    },
    series: [
      {
        type: "line",
        data: points.map((point) => (Number.isFinite(point.value) ? point.value : null)),
        smooth: false,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: theme.primary, width: 2 },
        itemStyle: { color: theme.primary },
        ...(hasThreshold
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: theme.riskBoundary, type: "dashed", width: 1.5 },
                label: {
                  position: "insideEndTop",
                  color: theme.riskBoundary,
                  fontSize: 12,
                  formatter: thresholdLabel ?? "",
                },
                data: [{ yAxis: threshold }],
              },
            }
          : {}),
        ...(last !== undefined
          ? {
              markPoint: {
                silent: true,
                symbol: "circle",
                symbolSize: 8,
                itemStyle: { color: theme.riskBoundary },
                label: {
                  position: "top",
                  color: theme.riskBoundary,
                  fontWeight: 600,
                  fontSize: 12,
                  formatter: `${last.value}${exceeded ? " · 已越限" : ""}`,
                },
                data: [{ coord: [last.date, last.value] }],
              },
            }
          : {}),
      },
    ],
  };

  const ref = useChart(option, [
    JSON.stringify(points),
    threshold,
    thresholdLabel,
    height,
    theme.primary,
    theme.border,
    theme.neutralSoft,
    theme.textSecondary,
    theme.riskBoundary,
  ]);
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
