import './KpiCard.css'

/** KPI 指标卡：label + 大数字 + 可选单位与小标签 */
export function KpiCard({
  label,
  value,
  unit,
  tag,
  tone = 'default',
}: {
  label: string
  value: string | number
  unit?: string
  tag?: string
  tone?: 'default' | 'risk'
}) {
  return (
    <section className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-main">
        <span className="kpi-value">{value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {tag && <span className={`kpi-tag${tone === 'risk' ? ' kpi-tag--risk' : ''}`}>{tag}</span>}
    </section>
  )
}
