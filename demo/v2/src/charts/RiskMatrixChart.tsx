// matrix（P/C 风险矩阵）：完全由版本化配置驱动渲染。
// 行/列刻度、等级文案与配色、单元格底色、可接受区边界、当前落点全部来自
// definition / plots 数据；组件内不存在任何矩阵维度或等级字面量（AGENTS.md §4.3）。
// RiskMatrixVersionChart 是接受「矩阵版本化配置」（含 entityId / versionId）的
// 便捷封装，配置本身由调用方（页面批次）提供。

import { ChartSurface } from './ChartSurface';
import {
  DEFAULT_CHART_THEME,
  resolveChartStatus,
  type ChartLegendItem,
  type ChartStateProps,
  type ChartTheme,
} from './types';

export interface RiskMatrixLevel {
  readonly key: string;
  /** 等级文案（如 I / II / III / IV 或映射名），完全由数据给出。 */
  readonly label: string;
  readonly color: string;
  readonly softColor: string;
}

export interface RiskMatrixAxis {
  readonly label: string;
  readonly ticks: readonly string[];
}

/** 可序列化的矩阵定义（可来自版本化配置 fixture）。 */
export interface RiskMatrixDefinition {
  /** 纵轴（发生可能性 P）：ticks 自低向高排列，渲染时 index 0 在底部。 */
  readonly probability: RiskMatrixAxis;
  /** 横轴（后果严重度 C）：ticks 自左向右排列。 */
  readonly consequence: RiskMatrixAxis;
  readonly levels: readonly RiskMatrixLevel[];
  /** cellLevels[pIndex][cIndex] = levels 中某项的 key。 */
  readonly cellLevels: readonly (readonly string[])[];
  /** 可接受区掩码，维度同 cellLevels；缺省则不绘制可接受边界。 */
  readonly acceptable?: readonly (readonly boolean[])[];
  /** 可接受阈值的版本号（呈现于边界标注）。 */
  readonly thresholdVersion?: string;
}

export interface RiskMatrixPlot {
  readonly id: string;
  /** probability.ticks 中的取值。 */
  readonly p: string;
  /** consequence.ticks 中的取值。 */
  readonly c: string;
  /** 该落点的记录数（缺省 1，同格合并累加）。 */
  readonly count?: number;
}

export interface RiskMatrixChartProps extends ChartStateProps {
  readonly definition: RiskMatrixDefinition;
  readonly plots?: readonly RiskMatrixPlot[];
  readonly cellSize?: number;
  readonly title?: string;
  readonly theme?: ChartTheme;
}

const AXIS_LEFT = 72;
const PAD_TOP = 28;
const PAD_RIGHT = 16;
const PAD_BOTTOM = 48;

interface BoundarySegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export function RiskMatrixChart({
  definition,
  plots = [],
  cellSize = 44,
  title,
  theme = DEFAULT_CHART_THEME,
  status: statusProp,
  unavailableReasons,
  emptyMessage = '暂无评估记录',
}: RiskMatrixChartProps) {
  const { probability, consequence, levels, cellLevels, acceptable, thresholdVersion } = definition;
  const pCount = probability.ticks.length;
  const cCount = consequence.ticks.length;
  const status = resolveChartStatus(pCount > 0 && cCount > 0 && levels.length > 0, statusProp);
  const levelByKey = new Map(levels.map((level) => [level.key, level]));

  const width = AXIS_LEFT + cCount * cellSize + PAD_RIGHT;
  const height = PAD_TOP + pCount * cellSize + PAD_BOTTOM;
  // pIndex 0 在底部：单元格 (p, c) 的 svg 左上角
  const cellX = (c: number): number => AXIS_LEFT + c * cellSize;
  const cellY = (p: number): number => PAD_TOP + (pCount - 1 - p) * cellSize;

  const acceptableAt = (p: number, c: number): boolean => acceptable?.[p]?.[c] ?? false;
  const boundarySegments: BoundarySegment[] = [];
  if (acceptable !== undefined) {
    for (let p = 0; p < pCount; p += 1) {
      for (let c = 0; c < cCount; c += 1) {
        const here = acceptableAt(p, c);
        if (c + 1 < cCount && here !== acceptableAt(p, c + 1)) {
          boundarySegments.push({
            x1: cellX(c + 1),
            y1: cellY(p),
            x2: cellX(c + 1),
            y2: cellY(p) + cellSize,
          });
        }
        if (p + 1 < pCount && here !== acceptableAt(p + 1, c)) {
          boundarySegments.push({
            x1: cellX(c),
            y1: cellY(p),
            x2: cellX(c) + cellSize,
            y2: cellY(p),
          });
        }
        if (here) {
          if (c === 0)
            boundarySegments.push({ x1: cellX(c), y1: cellY(p), x2: cellX(c), y2: cellY(p) + cellSize });
          if (c === cCount - 1)
            boundarySegments.push({
              x1: cellX(c) + cellSize,
              y1: cellY(p),
              x2: cellX(c) + cellSize,
              y2: cellY(p) + cellSize,
            });
          if (p === 0)
            boundarySegments.push({
              x1: cellX(c),
              y1: cellY(p) + cellSize,
              x2: cellX(c) + cellSize,
              y2: cellY(p) + cellSize,
            });
          if (p === pCount - 1)
            boundarySegments.push({ x1: cellX(c), y1: cellY(p), x2: cellX(c) + cellSize, y2: cellY(p) });
        }
      }
    }
  }

  const plotsByCell = new Map<string, number>();
  for (const plot of plots) {
    const key = `${plot.p}|${plot.c}`;
    plotsByCell.set(key, (plotsByCell.get(key) ?? 0) + (plot.count ?? 1));
  }

  const legend: ChartLegendItem[] =
    status === 'empty'
      ? []
      : [
          ...levels.map((level) => ({
            key: level.key,
            label: level.label,
            color: level.softColor,
            marker: 'square' as const,
          })),
          ...(acceptable === undefined
            ? []
            : [
                {
                  key: '__acceptable__',
                  label: '可接受边界',
                  color: theme.riskBoundary,
                  marker: 'line' as const,
                },
              ]),
        ];

  const body = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? '风险矩阵'}
    >
      {thresholdVersion === undefined ? null : (
        <text
          x={AXIS_LEFT + cCount * cellSize}
          y={PAD_TOP - 10}
          textAnchor="end"
          className="chart-tick"
        >
          可接受阈值 · {thresholdVersion}
        </text>
      )}
      {probability.ticks.map((tick, p) => (
        <text
          key={tick}
          x={AXIS_LEFT - 10}
          y={cellY(p) + cellSize / 2 + 4}
          textAnchor="end"
          className="chart-tick"
        >
          {tick}
        </text>
      ))}
      <text
        x={16}
        y={PAD_TOP + (pCount * cellSize) / 2}
        textAnchor="middle"
        className="chart-tick"
        transform={`rotate(-90 16 ${PAD_TOP + (pCount * cellSize) / 2})`}
      >
        {probability.label}
      </text>
      {consequence.ticks.map((tick, c) => (
        <text
          key={tick}
          x={cellX(c) + cellSize / 2}
          y={PAD_TOP + pCount * cellSize + 18}
          textAnchor="middle"
          className="chart-tick"
        >
          {tick}
        </text>
      ))}
      <text
        x={AXIS_LEFT + (cCount * cellSize) / 2}
        y={height - 8}
        textAnchor="middle"
        className="chart-tick"
      >
        {consequence.label}
      </text>
      {probability.ticks.map((_, p) =>
        consequence.ticks.map((_, c) => {
          const levelKey = cellLevels[p]?.[c];
          const level = levelKey === undefined ? undefined : levelByKey.get(levelKey);
          return (
            <rect
              key={`${p}-${c}`}
              x={cellX(c)}
              y={cellY(p)}
              width={cellSize}
              height={cellSize}
              fill={level?.softColor ?? theme.neutralSoft}
              stroke={theme.border}
              strokeWidth={1}
            />
          );
        }),
      )}
      {boundarySegments.map((segment, index) => (
        <line
          key={index}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          stroke={theme.riskBoundary}
          strokeWidth={1.5}
        />
      ))}
      {probability.ticks.map((pTick, p) =>
        consequence.ticks.map((cTick, c) => {
          const count = plotsByCell.get(`${pTick}|${cTick}`) ?? 0;
          if (count === 0) return null;
          const cx = cellX(c) + cellSize / 2;
          const cy = cellY(p) + cellSize / 2;
          return (
            <g key={`${pTick}|${cTick}`}>
              <circle cx={cx} cy={cy} r={4} fill={theme.primary} />
              {count > 1 ? (
                <g>
                  <circle cx={cx + 10} cy={cy - 10} r={7} fill={theme.primary} />
                  <text x={cx + 10} y={cy - 7} textAnchor="middle" className="chart-plot-count">
                    {count}
                  </text>
                </g>
              ) : null}
            </g>
          );
        }),
      )}
      {plots.length > 0 ? null : (
        <text
          x={AXIS_LEFT + (cCount * cellSize) / 2}
          y={PAD_TOP + (pCount * cellSize) / 2}
          textAnchor="middle"
          className="chart-empty-inline"
        >
          {emptyMessage}
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
      legend={legend}
      maxWidth={width + 32}
    >
      {body}
    </ChartSurface>
  );
}

/** 矩阵版本化配置：定义 + 版本身份。由调用方（页面批次）按配置数据提供。 */
export interface RiskMatrixVersionConfig extends RiskMatrixDefinition {
  readonly entityId: string;
  readonly versionId: string;
}

export interface RiskMatrixVersionChartProps extends Omit<RiskMatrixChartProps, 'definition'> {
  readonly config: RiskMatrixVersionConfig;
}

export function RiskMatrixVersionChart({ config, ...rest }: RiskMatrixVersionChartProps) {
  return (
    <div className="chart-matrix-version">
      <p className="chart-version mono">
        风险矩阵 {config.entityId} · {config.versionId}
      </p>
      <RiskMatrixChart definition={config} {...rest} />
    </div>
  );
}
