// trend（趋势折线）：主线 2px 工程蓝 + r3 节点；对比线 1.5px 蓝灰虚线。
// 阈值线：水平虚线 1.5px，按级别取风险色，右端标注并全部入图例。
// 越限：越限点连成的区间铺对应风险色 soft 底（透明度 60%），越限节点改风险色实心点。
// 空态：坐标系 + 一条灰虚线骨架。

import { ChartSurface } from './ChartSurface';
import {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartLegendItem,
  type ChartStateProps,
  type ChartTheme,
  type RiskLevelKey,
} from './types';

export interface TrendPoint {
  /** 类目型横轴取值（如日期、批次号）。 */
  readonly x: string;
  readonly y: number;
  readonly exceeded?: boolean;
  readonly riskLevel?: RiskLevelKey;
}

export interface TrendSeries {
  readonly key: string;
  readonly label: string;
  /** main：主线（默认）；compare：对比虚线。 */
  readonly kind?: 'main' | 'compare';
  readonly points: readonly TrendPoint[];
}

export interface TrendThreshold {
  readonly value: number;
  readonly label: string;
  readonly riskLevel?: RiskLevelKey;
}

export interface TrendChartProps extends ChartStateProps {
  readonly series: readonly TrendSeries[];
  /** viewBox 尺寸，默认 640×240。 */
  readonly width?: number;
  readonly height?: number;
  readonly thresholds?: readonly TrendThreshold[];
  readonly yUnit?: string;
  readonly title?: string;
  readonly theme?: ChartTheme;
}

const MARGIN = { top: 16, right: 16, bottom: 30, left: 48 };

export function TrendChart({
  series,
  width = 640,
  height = 240,
  thresholds = [],
  yUnit,
  title,
  theme = DEFAULT_CHART_THEME,
  status: statusProp,
  unavailableReasons,
  emptyMessage,
}: TrendChartProps) {
  const hasData = series.some((item) => item.points.length > 0);
  const status = resolveChartStatus(hasData, statusProp);

  const domain = series.find((item) => item.points.length > 0)?.points.map((p) => p.x) ?? [];
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const allValues = [
    ...series.flatMap((item) => item.points.map((point) => point.y)),
    ...thresholds.map((threshold) => threshold.value),
  ];
  const yMax = allValues.length > 0 ? Math.max(...allValues) * 1.1 : 1;
  const yMin = Math.min(0, ...(allValues.length > 0 ? allValues : [0]));
  const xFor = (index: number): number =>
    MARGIN.left + (domain.length <= 1 ? plotWidth / 2 : (index / (domain.length - 1)) * plotWidth);
  const yFor = (value: number): number =>
    MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;

  const legend: ChartLegendItem[] =
    status === 'empty'
      ? []
      : [
          ...series.map((item) => ({
            key: item.key,
            label: item.label,
            color: item.kind === 'compare' ? theme.neutral : theme.primary,
            marker: (item.kind === 'compare' ? 'dashed-line' : 'line') as 'dashed-line' | 'line',
          })),
          ...thresholds.map((threshold, index) => ({
            key: `__threshold__${index}`,
            label: threshold.label,
            color: theme.risk[threshold.riskLevel ?? 2],
            marker: 'dashed-line' as const,
          })),
        ];

  const gridTicks = [0, 1, 2, 3].map((index) => yMin + ((yMax - yMin) / 3) * index);
  const xLabelStride = domain.length > 8 ? Math.ceil(domain.length / 8) : 1;

  const emptyTrend = (
    <svg width={width} height={height} aria-hidden>
      {gridTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={MARGIN.left}
            y1={yFor(tick)}
            x2={width - MARGIN.right}
            y2={yFor(tick)}
            stroke={theme.border}
            strokeWidth={1}
          />
        </g>
      ))}
      <line
        x1={MARGIN.left}
        y1={height - MARGIN.bottom - 12}
        x2={width - MARGIN.right}
        y2={MARGIN.top + 12}
        stroke={theme.neutral}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
    </svg>
  );

  const body = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? '趋势图'}
    >
      {gridTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={MARGIN.left}
            y1={yFor(tick)}
            x2={width - MARGIN.right}
            y2={yFor(tick)}
            stroke={theme.border}
            strokeWidth={1}
          />
          <text x={MARGIN.left - 8} y={yFor(tick) + 4} textAnchor="end" className="chart-tick">
            {Number(tick.toFixed(1))}
            {tick === gridTicks[gridTicks.length - 1] ? (yUnit ?? '') : ''}
          </text>
        </g>
      ))}
      {domain.map((x, index) =>
        index % xLabelStride !== 0 ? null : (
          <text
            key={x}
            x={xFor(index)}
            y={height - MARGIN.bottom + 18}
            textAnchor="middle"
            className="chart-tick"
          >
            {x}
          </text>
        ),
      )}
      {series.map((item) => {
        const byX = new Map(item.points.map((point) => [point.x, point]));
        const ordered = domain
          .map((x, index) => ({ point: byX.get(x), index }))
          .filter((entry): entry is { point: TrendPoint; index: number } => entry.point !== undefined);
        // 越限区间带：连续越限点的最大连段
        const bands: { x1: number; x2: number; level: RiskLevelKey }[] = [];
        let runStart = -1;
        ordered.forEach(({ point }, position) => {
          const exceeded = point.exceeded === true;
          if (exceeded && runStart < 0) runStart = position;
          const runEnds = runStart >= 0 && (!exceeded || position === ordered.length - 1);
          if (runEnds) {
            const lastPosition = exceeded ? position : position - 1;
            const first = ordered[runStart];
            const last = ordered[lastPosition];
            const step = domain.length <= 1 ? plotWidth : plotWidth / (domain.length - 1);
            bands.push({
              x1: Math.max(MARGIN.left, xFor(first.index) - step / 2),
              x2: Math.min(width - MARGIN.right, xFor(last.index) + step / 2),
              level: first.point.riskLevel ?? 2,
            });
            runStart = -1;
          }
        });
        return (
          <g key={item.key}>
            {bands.map((band, index) => (
              <rect
                key={index}
                x={band.x1}
                y={MARGIN.top}
                width={band.x2 - band.x1}
                height={plotHeight}
                fill={theme.riskSoft[band.level]}
                opacity={0.6}
              />
            ))}
          </g>
        );
      })}
      {thresholds.map((threshold, index) => (
        <g key={index}>
          <line
            x1={MARGIN.left}
            y1={yFor(threshold.value)}
            x2={width - MARGIN.right}
            y2={yFor(threshold.value)}
            stroke={theme.risk[threshold.riskLevel ?? 2]}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={width - MARGIN.right}
            y={yFor(threshold.value) - 4}
            textAnchor="end"
            className="chart-tick"
          >
            {threshold.label}
          </text>
        </g>
      ))}
      {series.map((item) => {
        const byX = new Map(item.points.map((point) => [point.x, point]));
        const ordered = domain
          .map((x, index) => ({ point: byX.get(x), index }))
          .filter((entry): entry is { point: TrendPoint; index: number } => entry.point !== undefined);
        const polyline = ordered.map(({ point, index }) => `${xFor(index)},${yFor(point.y)}`).join(' ');
        const compare = item.kind === 'compare';
        return (
          <g key={item.key}>
            <polyline
              points={polyline}
              fill="none"
              stroke={compare ? theme.neutral : theme.primary}
              strokeWidth={compare ? 1.5 : 2}
              strokeDasharray={compare ? '4 3' : undefined}
            />
            {compare
              ? null
              : ordered.map(({ point, index }) => (
                  <circle
                    key={index}
                    cx={xFor(index)}
                    cy={yFor(point.y)}
                    r={3}
                    fill={
                      point.exceeded === true ? theme.risk[point.riskLevel ?? 2] : theme.primary
                    }
                  />
                ))}
          </g>
        );
      })}
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
      skeleton={emptyTrend}
    >
      {body}
    </ChartSurface>
  );
}
