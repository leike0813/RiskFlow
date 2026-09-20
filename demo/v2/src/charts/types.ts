// 图表共享契约：状态、图例、主题令牌。
// 颜色一律引用 tokens.css 的 CSS 变量，组件内不得出现硬编码色值。

export type ChartStatus = 'ready' | 'empty' | 'unavailable';

/** 无数据态原因码（对齐 PageFrame 的 SafeReason 形状）。 */
export interface ChartReason {
  readonly code: string;
}

export type RiskLevelKey = 1 | 2 | 3 | 4;

/** 图表主题令牌：默认值映射 tokens.css；调用方可整体替换（如暗色场景）。 */
export interface ChartTheme {
  readonly primary: string;
  readonly primarySoft: string;
  readonly review: string;
  readonly neutral: string;
  readonly neutralSoft: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly border: string;
  readonly surface: string;
  readonly risk: Readonly<Record<RiskLevelKey, string>>;
  readonly riskSoft: Readonly<Record<RiskLevelKey, string>>;
  readonly riskBoundary: string;
}

export const DEFAULT_CHART_THEME: ChartTheme = {
  primary: 'var(--blue)',
  primarySoft: 'var(--blue-soft)',
  review: 'var(--review)',
  neutral: 'var(--bluegray)',
  neutralSoft: 'var(--bluegray-soft)',
  text: 'var(--text)',
  textSecondary: 'var(--text-2)',
  border: 'var(--border)',
  surface: 'var(--card)',
  risk: {
    1: 'var(--risk-1)',
    2: 'var(--risk-2)',
    3: 'var(--risk-3)',
    4: 'var(--risk-4)',
  },
  riskSoft: {
    1: 'var(--risk-1-soft)',
    2: 'var(--risk-2-soft)',
    3: 'var(--risk-3-soft)',
    4: 'var(--risk-4-soft)',
  },
  riskBoundary: 'var(--risk-1-dark)',
};

export type ChartLegendMarker = 'square' | 'diamond' | 'line' | 'dashed-line' | 'dot';

export interface ChartLegendItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly marker?: ChartLegendMarker;
}

/** 五类图表共用的状态入参。 */
export interface ChartStateProps {
  /** 缺省时按数据有无推导：无数据 → empty。 */
  readonly status?: ChartStatus;
  readonly unavailableReasons?: readonly ChartReason[];
  readonly emptyMessage?: string;
}

export function resolveChartStatus(hasData: boolean, explicit?: ChartStatus): ChartStatus {
  if (explicit !== undefined) return explicit;
  return hasData ? 'ready' : 'empty';
}
