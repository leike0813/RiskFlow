import type { ReactNode } from 'react'
import './DataTable.css'

export interface DataTableColumn {
  key: string
  title: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  render?: (row: Record<string, unknown>) => ReactNode
}

/** 数据表格：无斑马纹，行 hover 浅灰，可选行点击 */
export function DataTable({
  columns,
  rows,
  onRowClick,
}: {
  columns: DataTableColumn[]
  rows: Record<string, unknown>[]
  onRowClick?: (row: Record<string, unknown>) => void
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={{ width: col.width, textAlign: col.align ?? 'left' }}>
              {col.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            className={onRowClick ? 'data-table-row--clickable' : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((col) => (
              <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                {col.render ? col.render(row) : (row[col.key] as ReactNode)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
