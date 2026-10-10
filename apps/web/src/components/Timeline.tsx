import "./Timeline.css";

export interface TimelineItem {
  time: string;
  title: string;
  actor?: string;
  tone?: "done" | "current";
}

/** 纵向时间线（审计事件流） */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={i} className={`timeline-item timeline-item--${it.tone ?? "done"}`}>
          <span className="timeline-dot" />
          <div className="timeline-content">
            <div className="timeline-head">
              <span className="timeline-time mono">{it.time}</span>
              <span className="timeline-title">{it.title}</span>
            </div>
            {it.actor && <div className="timeline-actor">操作者：{it.actor}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
