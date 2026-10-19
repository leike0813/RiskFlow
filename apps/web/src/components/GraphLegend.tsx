import { GRAPH_CATEGORY_STYLES } from "../charts/GraphView";
import { useChartTheme } from "../theme/DesignSystemProvider";
import "./GraphLegend.css";

/**
 * 图谱图例：分类色点 + 名称。
 * 配色与 GraphView 共用同一份受控分类样式，图例不再自抄一套字面量色值。
 */
export function GraphLegend({ categories }: { categories?: string[] }) {
  const theme = useChartTheme();
  const styles = GRAPH_CATEGORY_STYLES(theme);
  const items = categories ?? Object.keys(styles);
  const fallbackColor = styles["装备构件"]?.color ?? theme.border;
  return (
    <div className="graph-legend">
      {items.map((c) => (
        <span key={c} className="graph-legend-item">
          <span
            className="graph-legend-dot"
            style={{ background: styles[c]?.color ?? fallbackColor }}
          />
          {c}
        </span>
      ))}
    </div>
  );
}
