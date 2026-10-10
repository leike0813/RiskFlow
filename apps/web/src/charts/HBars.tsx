import { useChart } from "./useChart";
import type { EChartsCoreOption } from "echarts/core";

/** 横向条形图：高亮项工程蓝，其余蓝灰，条末显示数值 */
export function HBars({
  data,
  height,
}: {
  data: { name: string; value: number; highlight?: boolean }[];
  height: number;
}) {
  const option: EChartsCoreOption = {
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "none" } },
    xAxis: {
      type: "value",
      splitLine: { show: false },
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: data.map((d) => d.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#172b4d", fontSize: 13 },
    },
    series: [
      {
        type: "bar",
        barWidth: 16,
        data: data.map((d) => ({
          value: d.value,
          itemStyle: {
            color: d.highlight ? "#2166d1" : "#8fa6c0",
            borderRadius: [0, 3, 3, 0],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: "#172b4d",
          fontWeight: 600,
          fontSize: 13,
        },
      },
    ],
  };

  const ref = useChart(option, [JSON.stringify(data), height]);
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
