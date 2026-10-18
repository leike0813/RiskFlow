// PROTOTYPE · THROWAWAY — UI 重做票 05 共享零件。
// 风险四级色唯一出口在 RiskBadge；页面不得自行 import 风险色。

import type { ReactNode } from 'react';

export function RiskBadge({ levelId, label }: { levelId: string; label: string }) {
  const n = /^level-(\d)$/.exec(levelId)?.[1] ?? '1';
  return (
    <span className={`dl-risk dl-risk--lv${n}`}>
      <span className="dl-risk__dot" />
      {label}
    </span>
  );
}

export function StateTag({ state, children }: { state: 'done' | 'current' | 'pending'; children: ReactNode }) {
  return <span className={`dl-tag${state === 'current' ? ' dl-tag--accent' : ''}`}>{children}</span>;
}

export function Tag({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`dl-tag${accent ? ' dl-tag--accent' : ''}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="dl-kbd">{children}</kbd>;
}

export function KeyValue({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="dl-kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stats({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <div className="dl-stats">
      {items.map((s) => (
        <div className="dl-stat" key={s.label}>
          <div className="dl-stat-v">{s.value}</div>
          <div className="dl-stat-l">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Agent 主动在场：它看到了什么、要你决定什么。不写思维链。 */
export function AgentNote({ why, children, actions }: { why: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="dl-agent">
      <span className="dl-agent__icon" aria-hidden>◆</span>
      <div className="dl-agent__body">
        {children}
        <div className="dl-agent__why">{why}</div>
      </div>
      {actions ? <div className="dl-agent__acts">{actions}</div> : null}
    </div>
  );
}

/** Agent 增量：逐项可接受/拒绝，每项独立记录依据。 */
export function AgentDelta({ rows }: { rows: readonly { target: string; from?: ReactNode; to: ReactNode; basis: string }[] }) {
  return (
    <div className="dl-delta">
      <div className="dl-delta-hd">Agent 增量 · 逐项由你决定，系统不自动生效</div>
      {rows.map((r) => (
        <div className="dl-delta-row" key={r.target}>
          <div>
            <div className="dl-sm">
              <span className="dl-faint">{r.target}</span>
              {r.from ? <span className="dl-delta-old"> {r.from}</span> : null} → <strong>{r.to}</strong>
            </div>
            <div className="dl-xs dl-faint">依据：{r.basis}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="dl-btn dl-btn--sm" type="button">接受</button>
            <button className="dl-btn dl-btn--sm dl-btn--quiet" type="button">拒绝</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 技术 ID 辅助区：等宽小字沉底，不进标题、不进列表首列。 */
export function Ids({ pairs }: { pairs: readonly (readonly [string, string])[] }) {
  return (
    <div className="dl-xs dl-faint dl-mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', paddingTop: 8, borderTop: '1px solid var(--dl-border)' }}>
      {pairs.map(([k, v]) => (
        <span key={k}>{k} {v}</span>
      ))}
    </div>
  );
}

export function Shortcuts({ groups }: { groups: readonly { title: string; items: readonly (readonly [string, string])[] }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="dl-h3 dl-faint" style={{ marginBottom: 6 }}>{g.title}</div>
          <div className="dl-shortcuts">
            {g.items.map(([k, d]) => (
              <Row key={k} k={k} d={d} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ k, d }: { k: string; d: string }) {
  return (
    <>
      <kbd className="dl-kbd">{k}</kbd>
      <span className="dl-muted">{d}</span>
    </>
  );
}

/** 纵向叙事时间轴（B 方向主结构）。 */
export function Timeline({
  items,
}: {
  items: readonly {
    at: string;
    title: ReactNode;
    state: 'done' | 'current' | 'pending';
    meta?: ReactNode;
    body?: ReactNode;
  }[];
}) {
  return (
    <div className="dl-timeline">
      {items.map((it) => (
        <article className="dl-tl-item" data-state={it.state} key={it.at + String(it.title)}>
          <div className="dl-tl-when">{it.at}</div>
          <div className="dl-tl-rail"><span className="dl-tl-node" /></div>
          <div className="dl-tl-body">
            <div className="dl-tl-hd">
              <span className="dl-tl-title">{it.title}</span>
              {it.meta}
            </div>
            {it.body}
          </div>
        </article>
      ))}
    </div>
  );
}

export function Section({ title, action, children, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="dl-section">
      {title ? (
        <div className="dl-section-hd">
          <span className="dl-h2">{title}</span>
          {action}
        </div>
      ) : null}
      <div className={`dl-section-bd${flush ? ' dl-section-bd--flush' : ''}`}>{children}</div>
    </section>
  );
}
