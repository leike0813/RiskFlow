import { useChart } from "./useChart";
import { useChartTheme } from "../theme/DesignSystemProvider";
import type { ChartTheme } from "./types";
import type { EChartsCoreOption } from "echarts/core";

interface NodeStyle {
  color: string;
  textColor: string;
  borderColor?: string;
  borderWidth?: number;
}

/**
 * 图谱节点分类取自入口 Provider 解析出的实际色值——Canvas 不认 var()。
 * 「风险事件」是对象类别而非风险等级，因此用中性色加粗描边区分，不按等级取红色。
 */
export const GRAPH_CATEGORY_STYLES = (theme: ChartTheme): Record<string, NodeStyle> => ({
  工序: { color: theme.primary, textColor: "#ffffff" },
  机理: { color: theme.review, textColor: "#ffffff" },
  风险事件: {
    color: theme.neutralSoft,
    borderColor: theme.textSecondary,
    borderWidth: 2,
    textColor: theme.textSecondary,
  },
  资料证据: {
    color: theme.neutralSoft,
    borderColor: theme.border,
    borderWidth: 1,
    textColor: theme.textSecondary,
  },
  装备构件: { color: theme.border, textColor: theme.text },
});

/** 工序风险关联图谱视图（echarts graph，力导向布局） */
export function GraphView({
  nodes,
  edges,
  height,
}: {
  nodes: { id: string; name: string; category: string }[];
  edges: { source: string; target: string; label?: string }[];
  height: number;
}) {
  const theme = useChartTheme();
  const styles = GRAPH_CATEGORY_STYLES(theme);
  const fallbackStyle: NodeStyle = { color: theme.border, textColor: theme.text };

  const option: EChartsCoreOption = {
    tooltip: { trigger: "item" },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        force: { repulsion: 320, edgeLength: [80, 140], gravity: 0.08 },
        label: {
          show: true,
          position: "inside",
          fontSize: 11,
          formatter: "{b}",
        },
        edgeLabel: {
          show: true,
          fontSize: 10,
          color: theme.textSecondary,
          formatter: (p: { data?: { edgeLabel?: string } }) => p.data?.edgeLabel ?? "",
        },
        lineStyle: { color: theme.border, width: 1.2, curveness: 0.08 },
        emphasis: { disabled: true },
        data: nodes.map((n) => {
          const st = styles[n.category] ?? fallbackStyle;
          return {
            id: n.id,
            name: n.name,
            symbolSize: n.category === "工序" ? 64 : 52,
            itemStyle: {
              color: st.color,
              // 边框是可选视觉细节：缺省时只给填充色，不写 undefined 字段。
              ...(st.borderColor === undefined ? {} : { borderColor: st.borderColor }),
              ...(st.borderWidth === undefined ? {} : { borderWidth: st.borderWidth }),
            },
            label: { color: st.textColor },
          };
        }),
        links: edges.map((e) => ({
          source: e.source,
          target: e.target,
          edgeLabel: e.label,
        })),
      },
    ],
  };

  const ref = useChart(option, [
    JSON.stringify(nodes),
    JSON.stringify(edges),
    height,
    theme.primary,
    theme.review,
    theme.neutralSoft,
    theme.text,
    theme.textSecondary,
    theme.border,
  ]);
  return <div ref={ref} style={{ height, width: "100%" }} />;
}
