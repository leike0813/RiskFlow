/** 图表共享契约：状态、图例与主题令牌。颜色一律引用 tokens.css 变量，组件内不写死色值。 */

export type ChartStatus = "ready" | "empty" | "unavailable";

export interface ChartReason {
  readonly code: string;
}

export interface ChartTheme {
  readonly primary: string;
  readonly review: string;
  readonly neutralSoft: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly border: string;
  readonly riskBoundary: string;
  /** 等级配色由数据驱动：按 ordinal 升序取底色，不假设等级是 I～IV 四档。 */
  readonly levelPalette: readonly string[];
  /** 与 levelPalette 同序的底色上可读前景色；仅定义到该长度，超出即视为不可映射。 */
  readonly levelForegroundPalette: readonly string[];
}

export const DEFAULT_CHART_THEME: ChartTheme = {
  primary: "var(--blue)",
  review: "var(--review)",
  neutralSoft: "var(--bluegray-soft)",
  text: "var(--text)",
  textSecondary: "var(--text-2)",
  border: "var(--border)",
  riskBoundary: "var(--risk-1-dark)",
  levelPalette: [
    "var(--risk-4-soft)",
    "var(--risk-3-soft)",
    "var(--risk-2-soft)",
    "var(--risk-1-soft)",
  ],
  levelForegroundPalette: [
    "var(--risk-4-text)",
    "var(--risk-3-text)",
    "var(--risk-2-text)",
    "var(--risk-1-dark)",
  ],
};

export type ChartLegendMarker = "square" | "line" | "dot";

export interface ChartLegendItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly marker?: ChartLegendMarker;
}

export interface ChartStateProps {
  readonly status?: ChartStatus;
  readonly unavailableReasons?: readonly ChartReason[];
  readonly emptyMessage?: string;
}

export const resolveChartStatus = (hasData: boolean, explicit?: ChartStatus): ChartStatus =>
  explicit ?? (hasData ? "ready" : "empty");
