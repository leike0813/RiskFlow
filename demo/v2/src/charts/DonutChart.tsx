// donut（占比环）：环宽为半径 22%，中心总量 + 单位。
// 越限扇区改风险色（riskLevel 指定级别），图例追加菱形「越限」标记。
// 空态：灰环一整圈。

import { ChartSurface } from './ChartSurface';
import {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartStateProps,
  type ChartTheme,
  type RiskLevelKey,
} from './types';

export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** 缺省按默认色板循环着色。 */
  readonly color?: string;
  /** 越限扇区：改对应风险色并在图例追加菱形越限标记。 */
  readonly exceeded?: boolean;
  readonly riskLevel?: RiskLevelKey;
}

export interface DonutChartProps extends ChartStateProps {
  readonly data: readonly DonutSlice[];
  /** 外径 px，默认 180。 */
  readonly size?: number;
  /** 中心主数值（缺省为合计值的整数字符串）。 */
  readonly centerValue?: string;
  /** 中心数值下方的单位/说明。 */
  readonly centerLabel?: string;
  readonly title?: string;
  readonly theme?: ChartTheme;
  readonly showLegend?: boolean;
}

export function DonutChart({
  data,
  size = 180,
  centerValue,
  centerLabel,
  title,
  theme = DEFAULT_CHART_THEME,
  showLegend = true,
  status: statusProp,
  unavailableReasons,
  emptyMessage,
}: DonutChartProps) {
  const total = data.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const status = resolveChartStatus(total > 0, statusProp);
  const palette = [theme.primary, theme.neutral, theme.review];

  const radius = size / 2;
  const ringWidth = radius * 0.22;
  const arcRadius = radius - ringWidth / 2;
  const circumference = 2 * Math.PI * arcRadius;

  const sliceColor = (slice: DonutSlice, index: number): string => {
    if (slice.exceeded === true) return theme.risk[slice.riskLevel ?? 2];
    return slice.color ?? palette[index % palette.length];
  };

  const legend =
    status === 'empty'
      ? []
      : [
          ...data.map((slice, index) => ({
            key: slice.key,
            label: slice.label,
            color: sliceColor(slice, index),
            marker: (slice.exceeded === true ? 'diamond' : 'square') as 'diamond' | 'square',
          })),
          ...(data.some((slice) => slice.exceeded === true)
            ? [
                {
                  key: '__exceeded__',
                  label: '越限',
                  color: theme.risk[2],
                  marker: 'diamond' as const,
                },
              ]
            : []),
        ];

  const emptyRing = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="空占比环">
      <circle
        cx={radius}
        cy={radius}
        r={arcRadius}
        fill="none"
        stroke={theme.neutralSoft}
        strokeWidth={ringWidth}
      />
    </svg>
  );

  let offset = 0;
  const body = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={title ?? '占比环图'}
    >
      {data.map((slice, index) => {
        const fraction = total > 0 ? Math.max(0, slice.value) / total : 0;
        const length = fraction * circumference;
        const dashOffset = -offset;
        offset += length;
        return (
          <circle
            key={slice.key}
            cx={radius}
            cy={radius}
            r={arcRadius}
            fill="none"
            stroke={sliceColor(slice, index)}
            strokeWidth={ringWidth}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${radius} ${radius})`}
          />
        );
      })}
      <text x={radius} y={radius - 2} textAnchor="middle" className="chart-donut-value">
        {centerValue ?? String(Math.round(total))}
      </text>
      {centerLabel === undefined ? null : (
        <text x={radius} y={radius + 18} textAnchor="middle" className="chart-tick">
          {centerLabel}
        </text>
      )}
    </svg>
  );

  return (
    <ChartSurface
      title={title}
      status={status}
      unavailableReasons={unavailableReasons}
      emptyMessage={emptyMessage}
      legend={showLegend ? legend : []}
      maxWidth={size + 32}
      skeleton={emptyRing}
    >
      {body}
    </ChartSurface>
  );
}
