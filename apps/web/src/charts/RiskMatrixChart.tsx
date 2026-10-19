/**
 * 版本化 P/C 风险矩阵图（纯 SVG）：行/列刻度、等级配色、单元格底色、可接受区边界与
 * 落点全部来自矩阵定义数据，组件内没有任何矩阵维度或等级字面量，因此非 5×5 的
 * 矩阵版本同样按自身定义绘制。
 */
import { ChartSurface } from "./ChartSurface";
import {
  presentRiskLevel,
  RISK_COLOR_UNDEFINED_MESSAGE,
  type RiskLevelPresentation,
} from "../theme/riskPresentation.js";
import { useChartTheme } from "../theme/DesignSystemProvider.js";
import {
  resolveChartStatus,
  type ChartLegendItem,
  type ChartStateProps,
  type ChartTheme,
} from "./types";

export interface RiskMatrixLevel {
  readonly key: string;
  readonly label: string;
  /** 已发布配置给出的等级顺序；配色由它决定，不由数组位置或标识字面量推断。 */
  readonly ordinal: number;
}

export interface RiskMatrixAxis {
  readonly label: string;
  readonly ticks: readonly string[];
}

export interface RiskMatrixDefinition {
  /** 纵轴（可能性 P）：index 0 为最低，渲染时置于底部。 */
  readonly probability: RiskMatrixAxis;
  /** 横轴（后果 C）：index 0 为最左。 */
  readonly consequence: RiskMatrixAxis;
  readonly levels: readonly RiskMatrixLevel[];
  /** cellLevels[pIndex][cIndex] 为 levels 中某项 key。 */
  readonly cellLevels: readonly (readonly string[])[];
  readonly acceptable?: readonly (readonly boolean[])[];
  readonly thresholdVersion?: string;
}

export interface RiskMatrixPlot {
  readonly possibilityBandId: string;
  readonly consequenceBandId: string;
  readonly count?: number;
}

const AXIS_LEFT = 72;
const PAD_TOP = 28;
const PAD_RIGHT = 16;
const PAD_BOTTOM = 48;

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** 格子与落点的可读名称：可映射时给显示名，不可映射时保留实际标识并说明原因。 */
const accessibleLevelName = (presentation: RiskLevelPresentation): string =>
  presentation.label.length > 0 && presentation.mapped
    ? presentation.label
    : presentation.label.length > 0
      ? `${presentation.label}（${RISK_COLOR_UNDEFINED_MESSAGE}）`
      : `未标注等级（${RISK_COLOR_UNDEFINED_MESSAGE}）`;

export function RiskMatrixVersionChart({
  definition,
  plots = [],
  cellSize = 44,
  title,
  theme: themeProp,
  status: statusProp,
  unavailableReasons,
  emptyMessage = "暂无评估记录落点",
}: {
  definition: RiskMatrixDefinition;
  plots?: readonly RiskMatrixPlot[];
  cellSize?: number;
  title?: string;
  theme?: ChartTheme;
} & ChartStateProps) {
  // 显式主题（SSR/隔离测试）优先，否则消费入口 Provider 解析出的稳定主题。
  const unifiedTheme = useChartTheme();
  const theme = themeProp ?? unifiedTheme;
  const { probability, consequence, levels, cellLevels, acceptable, thresholdVersion } = definition;
  const pCount = probability.ticks.length;
  const cCount = consequence.ticks.length;
  const status = resolveChartStatus(pCount > 0 && cCount > 0 && levels.length > 0, statusProp);

  const width = AXIS_LEFT + cCount * cellSize + PAD_RIGHT;
  const height = PAD_TOP + pCount * cellSize + PAD_BOTTOM;
  const cellX = (c: number): number => AXIS_LEFT + c * cellSize;
  const cellY = (p: number): number => PAD_TOP + (pCount - 1 - p) * cellSize;

  // 等级配色只由发布配置给出的 ordinal 决定；位置、标识字面量和格子坐标都不参与。
  const presentationOf = (levelKey: string | undefined): RiskLevelPresentation =>
    presentRiskLevel(
      levelKey === undefined
        ? { levelId: "" }
        : {
            levelId: levelKey,
            ordinal: levels.find((level) => level.key === levelKey)?.ordinal,
            displayName: levels.find((level) => level.key === levelKey)?.label,
          },
      theme,
    );

  const acceptableAt = (p: number, c: number): boolean => acceptable?.[p]?.[c] ?? false;
  const boundarySegments: Segment[] = [];
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
        if (!here) continue;
        if (c === 0) {
          boundarySegments.push({
            x1: cellX(c),
            y1: cellY(p),
            x2: cellX(c),
            y2: cellY(p) + cellSize,
          });
        }
        if (c === cCount - 1) {
          boundarySegments.push({
            x1: cellX(c) + cellSize,
            y1: cellY(p),
            x2: cellX(c) + cellSize,
            y2: cellY(p) + cellSize,
          });
        }
        if (p === 0) {
          boundarySegments.push({
            x1: cellX(c),
            y1: cellY(p) + cellSize,
            x2: cellX(c) + cellSize,
            y2: cellY(p) + cellSize,
          });
        }
        if (p === pCount - 1) {
          boundarySegments.push({
            x1: cellX(c),
            y1: cellY(p),
            x2: cellX(c) + cellSize,
            y2: cellY(p),
          });
        }
      }
    }
  }

  const plotsByCell = new Map<string, number>();
  for (const plot of plots) {
    const key = `${plot.possibilityBandId}|${plot.consequenceBandId}`;
    plotsByCell.set(key, (plotsByCell.get(key) ?? 0) + (plot.count ?? 1));
  }

  const legend: ChartLegendItem[] =
    status === "empty"
      ? []
      : [
          ...levels.map((level) => {
            const presentation = presentationOf(level.key);
            return {
              key: level.key,
              label: accessibleLevelName(presentation),
              color: presentation.background,
            };
          }),
          ...(acceptable === undefined
            ? []
            : [
                {
                  key: "__acceptable__",
                  label: "可接受边界",
                  color: theme.riskBoundary,
                  marker: "line" as const,
                },
              ]),
        ];

  return (
    <ChartSurface
      title={title}
      status={status}
      unavailableReasons={unavailableReasons}
      emptyMessage={emptyMessage}
      legend={legend}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title ?? "风险矩阵"}
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
            const presentation = presentationOf(cellLevels[p]?.[c]);
            return (
              <rect
                key={`${p}-${c}`}
                x={cellX(c)}
                y={cellY(p)}
                width={cellSize}
                height={cellSize}
                fill={presentation.background}
                stroke={theme.border}
                strokeWidth={1}
              >
                <title>{accessibleLevelName(presentation)}</title>
              </rect>
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
        {consequence.ticks.map((cTick, c) =>
          probability.ticks.map((pTick, p) => {
            const count = plotsByCell.get(`${pTick}|${cTick}`) ?? 0;
            if (count === 0) return null;
            const cx = cellX(c) + cellSize / 2;
            const cy = cellY(p) + cellSize / 2;
            return (
              <g key={`${pTick}|${cTick}`}>
                <circle cx={cx} cy={cy} r={4} fill={theme.primary} />
                {count > 1 && (
                  <g>
                    <circle cx={cx + 10} cy={cy - 10} r={7} fill={theme.primary} />
                    <text x={cx + 10} y={cy - 7} textAnchor="middle" className="chart-plot-count">
                      {count}
                    </text>
                  </g>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </ChartSurface>
  );
}
