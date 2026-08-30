import { NavLink } from 'react-router-dom'
import './SectionTabs.css'

/** 导航项内部的二级页签（NavLink 实现） */
export function SectionTabs({ items }: { items: { to: string; label: string }[] }) {
  return (
    <nav className="section-tabs">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
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
