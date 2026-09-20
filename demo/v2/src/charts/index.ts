// 图表库入口：五类图表 + ChartSurface 接缝 + 共享类型。
// 视觉规范见 docs/DESIGN-SPEC.md §4；使用约定见 docs/PAGE-GUIDE.md §10。

export {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartLegendItem,
  type ChartLegendMarker,
  type ChartReason,
  type ChartStateProps,
  type ChartStatus,
  type ChartTheme,
  type RiskLevelKey,
} from './types';
export { ChartSurface, type ChartSurfaceProps } from './ChartSurface';
export { DonutChart, type DonutChartProps, type DonutSlice } from './DonutChart';
export {
  HBarsChart,
  type HBarsChartProps,
  type HBarsThreshold,
  type HBarItem,
} from './HBarsChart';
export {
  TrendChart,
  type TrendChartProps,
  type TrendPoint,
  type TrendSeries,
  type TrendThreshold,
} from './TrendChart';
export {
  GraphView,
  type GraphEdgeData,
  type GraphNodeData,
  type GraphNodeTone,
  type GraphViewProps,
} from './GraphView';
export {
  RiskMatrixChart,
  RiskMatrixVersionChart,
  type RiskMatrixAxis,
  type RiskMatrixChartProps,
  type RiskMatrixDefinition,
  type RiskMatrixLevel,
  type RiskMatrixPlot,
  type RiskMatrixVersionChartProps,
  type RiskMatrixVersionConfig,
} from './RiskMatrixChart';
