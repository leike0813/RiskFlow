// ChartSurface：五类图表的统一外观接缝。
// 承担：标题、图例（12×12 色块 + 文字，超过 6 项折叠为「更多」）、
// 空态（图表框 + 骨架 + 提示文案）、无数据态（不渲染图表框，说明 + 原因码）。
// 图表本体（ready 态的 SVG）与各图表自己的空态骨架由调用方传入。

import { useState, type ReactNode } from 'react';
import type { ChartLegendItem, ChartLegendMarker, ChartReason, ChartStatus } from './types';
import './charts.css';

const LEGEND_LIMIT = 6;

function LegendMarker({ color, marker }: { color: string; marker: ChartLegendMarker }) {
  if (marker === 'diamond') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <rect x="3" y="3" width="6" height="6" rx="1" transform="rotate(45 6 6)" fill={color} />
      </svg>
    );
  }
  if (marker === 'line' || marker === 'dashed-line') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <line
          x1="1"
          y1="6"
          x2="11"
          y2="6"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={marker === 'dashed-line' ? '3 2' : undefined}
        />
      </svg>
    );
  }
  if (marker === 'dot') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="3" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="1" y="1" width="10" height="10" rx="2" fill={color} />
    </svg>
  );
}

function ChartLegend({ items }: { items: readonly ChartLegendItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = items.length > LEGEND_LIMIT;
  const visible = collapsible && !expanded ? items.slice(0, LEGEND_LIMIT - 1) : items;
  return (
    <ul className="chart-legend">
      {visible.map((item) => (
        <li key={item.key} className="chart-legend-item">
          <LegendMarker color={item.color} marker={item.marker ?? 'square'} />
          <span>{item.label}</span>
        </li>
      ))}
      {collapsible ? (
        <li>
          <button
            type="button"
            className="chart-legend-toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : `更多 +${items.length - (LEGEND_LIMIT - 1)}`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

export interface ChartSurfaceProps {
  readonly title?: string;
  readonly status: ChartStatus;
  readonly unavailableReasons?: readonly ChartReason[];
  readonly emptyMessage?: string;
  readonly legend?: readonly ChartLegendItem[];
  readonly maxWidth?: number;
  /** empty 态在图表框内渲染的骨架（各图表按 DESIGN-SPEC §4 的空态约定提供）。 */
  readonly skeleton?: ReactNode;
  readonly children?: ReactNode;
}

export function ChartSurface({
  title,
  status,
  unavailableReasons = [],
  emptyMessage = '暂无可显示内容',
  legend = [],
  maxWidth,
  skeleton,
  children,
}: ChartSurfaceProps) {
  return (
    <figure className="chart-surface" style={maxWidth === undefined ? undefined : { maxWidth }}>
      {title === undefined ? null : <figcaption className="chart-title">{title}</figcaption>}
      {status === 'unavailable' ? (
        <div className="chart-unavailable" role="note">
          <p>图表数据当前不可用</p>
          {unavailableReasons.length > 0 ? (
            <ul>
              {unavailableReasons.map((reason) => (
                <li key={reason.code}>
                  <code>{reason.code}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : status === 'empty' ? (
        <div className="chart-frame chart-frame-empty">
          {skeleton}
          <p className="chart-empty-message">{emptyMessage}</p>
        </div>
      ) : (
        <div className="chart-frame">{children}</div>
      )}
      {status !== 'unavailable' && legend.length > 0 ? <ChartLegend items={legend} /> : null}
    </figure>
  );
}
