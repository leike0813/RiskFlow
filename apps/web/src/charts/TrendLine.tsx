import { useChart } from "./useChart";
import type { EChartsCoreOption } from "echarts/core";

/** 趋势折线：工程蓝折线 + 可选红色阈值虚线 + 末点红色标注（越限时附"已越限"） */
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
      axisLine: { lineStyle: { color: "#dce4ee" } },
      axisTick: { show: false },
      axisLabel: { color: "#63758a", fontSize: 12 },
    },
    yAxis: {
      type: "value",
      min: Math.floor(min * 0.9 * 10) / 10,
      max: Math.ceil(max * 1.08 * 10) / 10,
      splitLine: { lineStyle: { color: "#edf1f6" } },
      axisLabel: { color: "#63758a", fontSize: 12 },
    },
    series: [
      {
        type: "line",
        data: points.map((point) => (Number.isFinite(point.value) ? point.value : null)),
        smooth: false,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: "#2166d1", width: 2 },
        itemStyle: { color: "#2166d1" },
        ...(hasThreshold
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: "#d9363e", type: "dashed", width: 1.5 },
                label: {
                  position: "insideEndTop",
                  color: "#d9363e",
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
                itemStyle: { color: "#d9363e" },
                label: {
                  position: "top",
                  color: "#d9363e",
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

  const ref = useChart(option, [JSON.stringify(points), threshold, thresholdLabel, height]);
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
