import './RiskMatrix5x5.css'

const levelClass: Record<string, string> = {
  I: 'mx-cell--1',
  II: 'mx-cell--2',
  III: 'mx-cell--3',
  IV: 'mx-cell--4',
}

/**
 * 5×5 P/C 风险矩阵（纯 CSS 网格，不用 echarts）。
 * grid 行序为 P5→P1，列序为 C1→C5；highlight 为当前评估落点。
 */
export function RiskMatrix5x5({
  grid,
  highlight,
  height,
}: {
  grid: string[][]
  highlight: { p: number; c: number }
  height?: number
}) {
  const hlRow = 5 - highlight.p
  const hlCol = highlight.c - 1

  return (
    <div className="mx-wrap" style={height ? { height } : undefined}>
      <div className="mx-y-title">发生可能性 P</div>
      <div className="mx-body">
        <div className="mx-y-labels">
          {[5, 4, 3, 2, 1].map((p) => (
            <span key={p} className="mono">
              P{p}
            </span>
          ))}
        </div>
        <div className="mx-grid-col">
          <div className="mx-grid">
            {grid.map((row, r) =>
              row.map((lv, c) => {
                const isHl = r === hlRow && c === hlCol
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`mx-cell ${levelClass[lv] ?? ''}${isHl ? ' mx-cell--hl' : ''}`}
                  >
                    {lv}
                    {isHl && <span className="mx-current">当前</span>}
                  </div>
                )
              }),
            )}
          </div>
          <div className="mx-x-labels">
            {[1, 2, 3, 4, 5].map((c) => (
              <span key={c} className="mono">
                C{c}
              </span>
            ))}
          </div>
          <div className="mx-x-title">后果严重性 C</div>
        </div>
      </div>
    </div>
  )
}
