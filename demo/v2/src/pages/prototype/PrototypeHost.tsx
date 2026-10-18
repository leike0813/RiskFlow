// PROTOTYPE · THROWAWAY — UI 重做票 05 的原型宿主。
// 新外壳（图标导轨 + ⌘K + 全键盘 + Agent 停靠区），页面从 pages/index.ts 取。

import { useCallback, useEffect, useState } from 'react';
import { Shell } from './Shell';
import { PAGES, INDEX_PAGE, NAV_LANDING } from './pages';
import './dl.css';

export function PrototypeHost() {
  const [tab, setTab] = useState<string>(INDEX_PAGE.tab);

  const onTab = useCallback((key: string) => {
    // ⌘K 的 nav:/cmd: 前缀、g+digit 与导轨点击都走这里：先落到一级导航的落地页
    const asNav = key.startsWith('nav:') ? key.slice(4) : key;
    if (asNav === 'shortcuts') { setTab('__shortcuts'); return; }
    const landing = NAV_LANDING[asNav];
    if (landing) setTab(landing);
    else if (PAGES[asNav]) setTab(asNav);
  }, []);

  useEffect(() => {
    const read = () => {
      const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('p');
      if (raw && (raw === '__shortcuts' || PAGES[raw])) setTab(raw);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  useEffect(() => {
    const url = `${window.location.pathname}#/prototype/ui?p=${tab}`;
    window.history.replaceState(null, '', url);
  }, [tab]);

  const Page = PAGES[tab];

  return (
    <Shell tab={tab} onTab={onTab}>
      {Page ? <Page /> : null}
    </Shell>
  );
}
