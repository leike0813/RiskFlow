import { NavLink, useLocation } from "react-router-dom";
import "./SectionTabs.css";

/** 目标地址拆成 pathname 与自身 query：目标 query 覆盖当前值，其余当前参数保留。 */
const splitTarget = (to: string): { pathname: string; params: URLSearchParams } => {
  const index = to.indexOf("?");
  return index === -1
    ? { pathname: to, params: new URLSearchParams() }
    : { pathname: to.slice(0, index), params: new URLSearchParams(to.slice(index + 1)) };
};

/** 导航项内部的二级页签（NavLink 实现）；保留当前查询串以维持工程上下文。 */
export function SectionTabs({ items }: { items: { to: string; label: string }[] }) {
  const location = useLocation();
  return (
    <nav className="section-tabs">
      {items.map((it) => {
        const target = splitTarget(it.to);
        const merged = new URLSearchParams(location.search);
        // 目标地址自带的 query 优先（例如运行页签的 tab=runs）。
        target.params.forEach((value, key) => merged.set(key, value));
        return (
          <NavLink
            key={it.to}
            to={{ pathname: target.pathname, search: merged.toString() }}
            end
            className={({ isActive }) => `section-tab${isActive ? " section-tab--active" : ""}`}
          >
            {it.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
