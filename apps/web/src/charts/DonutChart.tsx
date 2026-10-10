import { useChart } from "./useChart";
import type { EChartsCoreOption } from "echarts/core";

/** 紧凑环图（风险等级分布等） */
export function DonutChart({
  data,
  centerLabel,
  height,
}: {
  data: { name: string; value: number; color: string }[];
  centerLabel: string;
  height: number;
}) {
  const option: EChartsCoreOption = {
    tooltip: { trigger: "item", formatter: "{b}：{c}（{d}%）" },
    title: {
      text: centerLabel,
      left: "center",
      top: "center",
      textStyle: { fontSize: 16, fontWeight: 600, color: "#172b4d" },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "80%"],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: { label: { show: false } },
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color },
        })),
      },
    ],
  };

  const ref = useChart(option, [JSON.stringify(data), centerLabel, height]);
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
