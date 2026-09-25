import { NavLink, useLocation } from 'react-router-dom'
import './SectionTabs.css'

/** 导航项内部的二级页签（NavLink 实现）；保留当前查询串以维持工程上下文。 */
export function SectionTabs({ items }: { items: { to: string; label: string }[] }) {
  const location = useLocation()
  return (
    <nav className="section-tabs">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={{ pathname: it.to, search: location.search }}
          end
          className={({ isActive }) =>
            `section-tab${isActive ? ' section-tab--active' : ''}`
          }
        >
          {it.label}
        </NavLink>
      ))}
    </nav>
  )
}
