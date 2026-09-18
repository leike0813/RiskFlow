// 审阅覆盖层（框架层注入，默认全部关闭）：
// - ?gaps=on      当前页面关联缺口的浮动标注
// - ?vp=…         视口宽度参考线
// - ?safearea=on  Electron 可拖拽安全区高亮
// 关闭时页面与截图不出现任何缺口或内部信息。

import { gapsForPage } from './gapLedger';
import './overlays.css';

export function GapsOverlay({ pageId }: { readonly pageId: string | null }) {
  const gaps = pageId === null ? [] : gapsForPage(pageId);
  return (
    <aside className="gaps-overlay" aria-label="缺口标注（审阅）" data-review-overlay="true">
      <p className="gaps-overlay-title">缺口标注</p>
      {gaps.length === 0 ? (
        <p className="gaps-overlay-empty">本页未登记页面级缺口</p>
      ) : (
        <ul>
          {gaps.map((gap) => (
            <li key={gap.id}>
              <span className="mono">{gap.id}</span> {gap.title}
            </li>
          ))}
        </ul>
      )}
      <p className="gaps-overlay-hint">完整台账见 #/__review 缺口面板</p>
    </aside>
  );
}

const VIEWPORT_WIDTHS: Readonly<Record<string, string>> = {
  '1920': '1920px',
  '1440': '1440px',
  '1280': '1280px',
  '1024': '64rem',
  min: '64rem',
};

export function ViewportOverlay({ preset }: { readonly preset: string }) {
  const width = VIEWPORT_WIDTHS[preset] ?? '64rem';
  const label =
    preset === 'min'
      ? `最小窗口声明 64rem × 40rem（当前 ${window.innerWidth}×${window.innerHeight}）`
      : `视口预设 ${preset}px（当前 ${window.innerWidth}px）`;
  return (
    <div className="viewport-overlay" aria-hidden="true" data-review-overlay="true">
      <div className="viewport-overlay-frame" style={{ width, maxWidth: '100vw' }}>
        <span className="viewport-overlay-label">{label}</span>
      </div>
    </div>
  );
}

export function SafeAreaOverlay() {
  return (
    <div className="safearea-overlay" aria-hidden="true" data-review-overlay="true">
      <span className="safearea-overlay-label">Electron 可拖拽安全区（高 28px，交互控件不得放入）</span>
    </div>
  );
}
