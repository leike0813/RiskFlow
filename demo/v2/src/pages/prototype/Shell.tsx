// PROTOTYPE · THROWAWAY — UI 重做票 05 的外壳。
// 替代 v2 AppShell（深蓝左导航 + 宽卡片）：图标导轨 + ⌘K 一级入口 + 全键盘 + Agent 停靠区。
// 硬边界：不走 preload/IPC，全部能力是页面内 DOM 事件（AGENTS.md 无关，Electron 现状决定）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/icons';
import { Kbd } from './parts';
import { AgentWorkTab } from './AgentWorkTab';

export type ShellTab = { key: string; label: string; icon: IconName; hotkey: string };

/** 全局导航（用户定的六项，票 02）。图标取 v2 既有 1.5px 线性图标集，不另造。 */
export const NAV: readonly ShellTab[] = [
  { key: 'overview', label: '风险总览', icon: 'overview', hotkey: 'g 1' },
  { key: 'engineering', label: '工程', icon: 'project', hotkey: 'g 2' },
  { key: 'identification', label: '识别', icon: 'identification', hotkey: 'g 3' },
  { key: 'assessment', label: '评估', icon: 'assessment', hotkey: 'g 4' },
  { key: 'response', label: '预警与处置', icon: 'warnings', hotkey: 'g 5' },
  { key: 'governance', label: '治理', icon: 'knowledge', hotkey: 'g 6' },
];

function CommandPalette({ onClose, onPick }: { onClose: () => void; onPick: (key: string) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const items = NAV.map((n) => ({ group: '转到', key: n.key, label: n.label, hint: '页面' }));
    items.push(
      { group: '命令', key: 'cmd:agent', label: '让智能助手处理当前对象', hint: 'Agent' },
      { group: '命令', key: 'cmd:review', label: '查看待我复核的', hint: '待办' },
      { group: '命令', key: 'cmd:shortcuts', label: '快捷键', hint: '?' },
      { group: '对象', key: 'obj:WRT-2026-001', label: '掌子面稳定性失效 · 处置任务', hint: 'WRT-2026-001' },
      { group: '对象', key: 'obj:RISK-2026-001', label: '掌子面稳定性失效 · 风险记录', hint: 'RISK-2026-001' },
    );
    const kw = q.trim();
    return kw ? items.filter((i) => i.label.includes(kw)) : items;
  }, [q]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, groups.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const hit = groups[sel];
        if (hit) { onPick(hit.key); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, sel, onClose, onPick]);

  return (
    <div className="dl-cmdk-mask" onMouseDown={onClose}>
      <div className="dl-cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="dl-cmdk-input"
          placeholder="搜索风险、资料、任务，或输入命令…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {Object.entries(
            groups.reduce<Record<string, typeof groups>>((acc, i) => {
              (acc[i.group] ??= []).push(i);
              return acc;
            }, {}),
          ).map(([g, items]) => (
            <div className="dl-cmdk-group" key={g}>
              <div className="dl-cmdk-group-hd">{g}</div>
              {items.map((i) => (
                <div
                  className="dl-cmdk-item"
                  key={i.key}
                  aria-selected={items.indexOf(i) === sel}
                  onMouseEnter={() => setSel(items.indexOf(i))}
                  onClick={() => { onPick(i.key); onClose(); }}
                >
                  <span>{i.label}</span>
                  <span className="dl-cmdk-hint">{i.hint}</span>
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 ? <div className="dl-cmdk-item dl-faint">没有匹配项</div> : null}
        </div>
      </div>
    </div>
  );
}

/** 停靠区：待办 + 助手工作。不做聊天框。 */
function Dock() {
  const [tab, setTab] = useState<'todo' | 'agent'>('todo');

  return (
    <aside className="dl-dock">
      <div className="dl-dock-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'todo'} className="dl-dock-tab" onClick={() => setTab('todo')}>
          待办 <span className="dl-tag dl-tag--accent">3</span>
        </button>
        <button role="tab" aria-selected={tab === 'agent'} className="dl-dock-tab" onClick={() => setTab('agent')}>
          助手工作
        </button>
      </div>
      <div className="dl-dock-bd">
        {tab === 'todo' ? (
          <>
            <div className="dl-dock-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>复核识别候选</strong>
                <span className="dl-xs dl-faint">2 项</span>
              </div>
              <div className="dl-xs dl-faint">风险记录 · 08-28 10:02</div>
            </div>
            <div className="dl-dock-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>确认预警</strong>
                <span className="dl-xs dl-faint">1 项</span>
              </div>
              <div className="dl-xs dl-faint">地表沉降速率越限 · 08-28 06:00</div>
            </div>
            <div className="dl-dock-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>校准建议待确认</strong>
                <span className="dl-xs dl-faint">1 项</span>
              </div>
              <div className="dl-xs dl-faint">处置效果偏差超阈值</div>
            </div>
            <div className="dl-rule" />
            <div className="dl-h3 dl-faint" style={{ marginBottom: 6 }}>智能助手</div>
            <div className="dl-xs dl-muted" style={{ lineHeight: '18px' }}>
              助手知道当前打开的对象与工程上下文，会主动把需要你决定的事项摆到页面上。它不替你做正式决定。
            </div>
            <button className="dl-btn dl-btn--sm" type="button" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>
              让助手看看这个对象
            </button>
          </>
        ) : (
          <AgentWorkTab />
        )}
      </div>
    </aside>
  );
}

export function Shell({
  tab,
  onTab,
  children,
  dock = true,
}: {
  tab: string;
  onTab: (key: string) => void;
  children: React.ReactNode;
  dock?: boolean;
}) {
  const [palette, setPalette] = useState(false);
  const [open, setOpen] = useState(true);
  const pendingG = useRef(false);

  const openPalette = useCallback(() => setPalette(true), []);
  const pick = useCallback((key: string) => {
    if (key.startsWith('nav:')) onTab(key.slice(4));
    if (key.startsWith('cmd:')) onTab(key.slice(4));
  }, [onTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setOpen((v) => !v); return; }
      if (e.key === '?') { e.preventDefault(); onTab('shortcuts'); return; }
      // g 前缀：g 然后 1-6 跳一级导航
      if (e.key === 'g') { pendingG.current = true; window.setTimeout(() => { pendingG.current = false; }, 900); return; }
      if (pendingG.current && /^[1-6]$/.test(e.key)) {
        pendingG.current = false;
        onTab(NAV[Number(e.key) - 1]!.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTab]);

  return (
    <div className="dl">
      <div className="dl-topbar">
        <button
          className="dl-rail-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? '收起导航' : '展开导航'}
          aria-label={open ? '收起导航' : '展开导航'}
        >
          <Icon name={open ? 'close' : 'overview'} size={14} />
        </button>
        <button className="dl-omnibox" onClick={openPalette} title="搜索、命令与助手（⌘K）">
          <span className="dl-omnibox-hint">搜索风险、资料、任务，或输入命令…</span>
          <span className="dl-omnibox-key"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </button>
        <span className="dl-topbar-ctx">掌子面稳定性失效 · 处置任务</span>
        <button className="dl-topbar-user" title="用户">
          <Icon name="settings" size={14} />
        </button>
      </div>

      <div className={`dl-shell${open ? '' : ' dl-shell--collapsed'}`}>
        <nav className="dl-rail" aria-label="一级导航">
          {NAV.map((n, i) => (
            <button
              key={n.key}
              className="dl-rail-item"
              aria-current={tab === n.key ? 'page' : undefined}
              title={`${n.label}　${n.hotkey}`}
              onClick={() => onTab(n.key)}
            >
              <Icon name={n.icon} size={17} />
              <span className="dl-rail-label">{n.label}</span>
              <span className="dl-rail-key">{i + 1}</span>
            </button>
          ))}
        </nav>

        <div className="dl-body">
          <main className="dl-main">{children}</main>
          {dock ? <Dock /> : null}
        </div>
      </div>

      {palette ? <CommandPalette onClose={() => setPalette(false)} onPick={pick} /> : null}
    </div>
  );
}
