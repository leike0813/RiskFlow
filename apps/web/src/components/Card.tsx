import type { CSSProperties, ReactNode } from "react";
import "./Card.css";

/** 白底业务卡片 */
export function Card({
  title,
  extra,
  children,
  style,
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      {(title || extra) && (
        <header className="card-header">
          {title && <h3 className="card-title">{title}</h3>}
          {extra && <div className="card-extra">{extra}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}
