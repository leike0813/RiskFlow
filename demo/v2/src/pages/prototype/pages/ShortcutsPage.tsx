// PROTOTYPE · THROWAWAY — 票 05 第 27 页：快捷键面板
// 由 Shell 的 __shortcuts 触发（按 ?），不在一级导航内。

import { Kbd, Section, Shortcuts } from '../parts';

export function ShortcutsPage() {
  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">快捷键面板</div>
          <h1 className="dl-h1">快捷键</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">所有交互都有键盘路径；Tab 在区域内移动，Esc 关闭浮层</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">关闭</button>
        </div>
      </header>

      <Section>
        <Shortcuts
          groups={[
            {
              title: '入口',
              items: [
                ['⌘K', '命令面板：搜索、命令、Agent 三合一'],
                ['?', '打开本快捷键面板'],
                ['Esc', '关闭浮层（命令面板、快捷键面板、对话框）'],
              ],
            },
            {
              title: '一级导航',
              items: [
                ['g 然后 1', '风险总览'],
                ['g 然后 2', '工程'],
                ['g 然后 3', '识别'],
                ['g 然后 4', '评估'],
                ['g 然后 5', '预警与处置'],
                ['g 然后 6', '治理'],
              ],
            },
            {
              title: '页面内',
              items: [
                ['⌘↵', '执行当前页主操作（如提请发布、开始新一轮）'],
                ['Tab', '在当前区域内移动焦点'],
                ['↑ ↓', '在列表中移动当前行'],
                ['↵', '打开当前行'],
              ],
            },
            {
              title: '表格与矩阵',
              items: [
                ['← →', '在表格列之间移动'],
                ['Space', '展开或收起当前行'],
                ['Home / End', '跳到首行或末行'],
              ],
            },
            {
              title: 'Agent',
              items: [
                ['⌘K 输入「@」', '在命令面板里向 Agent 提问'],
                ['⌘↵', '对选中的 Agent 增量逐项接受或拒绝'],
              ],
            },
          ]}
        />
      </Section>

      <Section title="提示">
        <ul className="dl-sm dl-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>在输入框或可编辑区域内打字时，g 前缀与数字快捷键不生效，避免误跳页。</li>
          <li>
            所有可聚焦元素都有可见焦点框（<Kbd>Tab</Kbd> 走一圈可以看到）。
          </li>
          <li>快捷键在窄屏与宽屏一致，本应用按桌面端宽度设计，不做响应式折叠。</li>
        </ul>
      </Section>
    </div>
  );
}
