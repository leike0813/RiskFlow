// hbars（横向条形）：条高 20px、间距 12px；标签左置、数值右置。
// 阈值线：竖直虚线 1.5px（默认 risk-2），右侧标注阈值名与数值。
// 越限条形改对应风险色，数值加粗并附「越限」文字徽标。空态：三条灰条骨架。

import { ChartSurface } from './ChartSurface';
import {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartStateProps,
  type ChartTheme,
  type RiskLevelKey,
} from './types';

export interface HBarItem {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** 数值的呈现文本（缺省为 value 字符串 + unit）。 */
  readonly displayValue?: string;
  readonly color?: string;
  readonly exceeded?: boolean;
  readonly riskLevel?: RiskLevelKey;
}

export interface HBarsThreshold {
  readonly value: number;
  readonly label: string;
  readonly color?: string;
}

export interface HBarsChartProps extends ChartStateProps {
  readonly data: readonly HBarItem[];
  /** viewBox 宽度，默认 640。 */
  readonly width?: number;
  readonly barHeight?: number;
  readonly barGap?: number;
  /** 刻度最大值，缺省取数据与阈值的最大值。 */
  readonly maxValue?: number;
  readonly threshold?: HBarsThreshold;
  readonly unit?: string;
  readonly title?: string;
  readonly theme?: ChartTheme;
}

const LABEL_WIDTH = 148;
const VALUE_WIDTH = 96;
const PAD_Y = 24;

export function HBarsChart({
  data,
  width = 640,
  barHeight = 20,
  barGap = 12,
  maxValue,
  threshold,
  unit,
  title,
  theme = DEFAULT_CHART_THEME,
  status: statusProp,
  unavailableReasons,
  emptyMessage,
}: HBarsChartProps) {
  const status = resolveChartStatus(data.length > 0, statusProp);
  const chartWidth = width - LABEL_WIDTH - VALUE_WIDTH;
  const height = Math.max(data.length, 1) * (barHeight + barGap) - barGap + PAD_Y * 2;
  const scaleMax =
    maxValue ??
    Math.max(1, ...data.map((item) => item.value), threshold?.value ?? 0) * 1.05;
  const xFor = (value: number): number => LABEL_WIDTH + (value / scaleMax) * chartWidth;

  const legend =
    threshold === undefined || status === 'empty'
      ? []
      : [
          {
            key: '__threshold__',
            label: `${threshold.label} ${threshold.value}${unit ?? ''}`,
            color: threshold.color ?? theme.risk[2],
            marker: 'dashed-line' as const,
          },
        ];

  const emptyBars = (
    <svg width={width} height={PAD_Y * 2 + 3 * (barHeight + barGap) - barGap} aria-hidden>
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={LABEL_WIDTH}
          y={PAD_Y + index * (barHeight + barGap)}
          width={chartWidth * (0.85 - index * 0.2)}
          height={barHeight}
          rx={4}
          fill={theme.neutralSoft}
        />
      ))}
    </svg>
  );

  const body = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? '横向条形图'}
    >
      {data.map((item, index) => {
        const y = PAD_Y + index * (barHeight + barGap);
        const barWidth = Math.max(0, (item.value / scaleMax) * chartWidth);
        const exceeded = item.exceeded === true;
        const fill = exceeded
          ? theme.risk[item.riskLevel ?? 2]
          : (item.color ?? theme.primary);
        return (
          <g key={item.key}>
            <text x={LABEL_WIDTH - 8} y={y + barHeight / 2 + 4} textAnchor="end" className="chart-label">
              {item.label}
            </text>
            <rect x={LABEL_WIDTH} y={y} width={barWidth} height={barHeight} rx={4} fill={fill} />
            {exceeded ? (
              <text
                x={LABEL_WIDTH + chartWidth + 8}
                y={y + barHeight / 2 + 4}
                className="chart-badge"
                fill={theme.risk[item.riskLevel ?? 2]}
              >
                越限
              </text>
            ) : null}
            <text
              x={width - 4}
              y={y + barHeight / 2 + 4}
              textAnchor="end"
              className={exceeded ? 'chart-value chart-value-bold' : 'chart-value'}
            >
              {item.displayValue ?? `${item.value}${unit ?? ''}`}
            </text>
          </g>
        );
      })}
      {threshold === undefined ? null : (
        <g>
          <line
            x1={xFor(threshold.value)}
            y1={PAD_Y - 12}
            x2={xFor(threshold.value)}
            y2={height - PAD_Y + 8}
            stroke={threshold.color ?? theme.risk[2]}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={Math.min(xFor(threshold.value) + 6, width - 4)}
            y={PAD_Y - 14}
            className="chart-tick"
          >
            {threshold.label} {threshold.value}
            {unit ?? ''}
          </text>
        </g>
      )}
    </svg>
  );

  return (
    <ChartSurface
      title={title}
      status={status}
      unavailableReasons={unavailableReasons}
      emptyMessage={emptyMessage}
      legend={legend}
      maxWidth={width + 32}
      skeleton={emptyBars}
    >
      {body}
    </ChartSurface>
  );
}
