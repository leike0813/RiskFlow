/**
 * 图表外观接缝：标题、图例、empty 骨架与 unavailable 说明。
 * unavailable 态只呈现原因码，不渲染图表框——一个来源失败不冒充完整图表。
 */
import { useState, type ReactNode } from 'react'
import type { ChartLegendItem, ChartLegendMarker, ChartReason, ChartStatus } from './types'
import './ChartSurface.css'

const LEGEND_LIMIT = 8

const LegendMarker = ({ color, marker }: { color: string; marker: ChartLegendMarker }) => {
  if (marker === 'line') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <line x1="1" y1="6" x2="11" y2="6" stroke={color} strokeWidth="1.5" />
      </svg>
    )
  }
  if (marker === 'dot') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="3" fill={color} />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="1" y="1" width="10" height="10" rx="2" fill={color} />
    </svg>
  )
}

const ChartLegend = ({ items }: { items: readonly ChartLegendItem[] }) => {
  const [expanded, setExpanded] = useState(false)
  const collapsible = items.length > LEGEND_LIMIT
  const visible = collapsible && !expanded ? items.slice(0, LEGEND_LIMIT - 1) : items
  return (
    <ul className="chart-legend">
      {visible.map((item) => (
        <li key={item.key} className="chart-legend-item">
          <LegendMarker color={item.color} marker={item.marker ?? 'square'} />
          <span>{item.label}</span>
        </li>
      ))}
      {collapsible && (
        <li>
          <button
            type="button"
            className="chart-legend-toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : `更多 +${items.length - (LEGEND_LIMIT - 1)}`}
          </button>
        </li>
      )}
    </ul>
  )
}

export function ChartSurface({
  title,
  status,
  unavailableReasons = [],
  emptyMessage = '暂无可显示内容',
  legend = [],
  children,
}: {
  title?: string
  status: ChartStatus
  unavailableReasons?: readonly ChartReason[]
  emptyMessage?: string
  legend?: readonly ChartLegendItem[]
  children?: ReactNode
}) {
  return (
    <figure className="chart-surface">
      {title === undefined ? null : <figcaption className="chart-title">{title}</figcaption>}
      {status === 'unavailable' ? (
        <div className="chart-unavailable" role="note">
          <p>该来源当前不可用</p>
          {unavailableReasons.length > 0 && (
            <ul>
              {unavailableReasons.map((reason) => (
                <li key={reason.code}>
                  <code>{reason.code}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : status === 'empty' ? (
        <div className="chart-frame chart-frame-empty">
          <p className="chart-empty-message">{emptyMessage}</p>
        </div>
      ) : (
        <div className="chart-frame">{children}</div>
      )}
      {status !== 'unavailable' && legend.length > 0 && <ChartLegend items={legend} />}
    </figure>
  )
}
