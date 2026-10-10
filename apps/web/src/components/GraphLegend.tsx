import "./GraphLegend.css";

/** 图谱节点分类配色（与 GraphView 一致） */
export const graphCategoryColors: Record<string, string> = {
  工序: "#2166d1",
  机理: "#7e7390",
  风险事件: "#d9363e",
  资料证据: "#c3cfdd",
  装备构件: "#8fa6c0",
};

/** 图谱图例：分类色点 + 名称 */
export function GraphLegend({ categories }: { categories?: string[] }) {
  const items = categories ?? Object.keys(graphCategoryColors);
  return (
    <div className="graph-legend">
      {items.map((c) => (
        <span key={c} className="graph-legend-item">
          <span
            className="graph-legend-dot"
            style={{ background: graphCategoryColors[c] ?? "#8fa6c0" }}
          />
          {c}
        </span>
      ))}
    </div>
  );
}
