// 示例工程上下文选项（设计原型期固定样例；正式接入后由工程数据替换）。
// 供外壳的工程 / 空间区段 / 工序节点三级上下文选择器使用。

export interface ContextOption {
  readonly id: string;
  readonly label: string;
}

export const SHELL_PROJECT_OPTIONS: readonly ContextOption[] = [
  { id: 'PRJ-001', label: '示例工程 · 站隧一体化标' },
  { id: 'PRJ-002', label: '示例工程 · 变径盾构区间' },
];

export const SHELL_SPATIAL_OPTIONS: readonly ContextOption[] = [
  { id: 'SS-001', label: '区段一 · 始发井至换乘段' },
  { id: 'SS-002', label: '区段二 · 换乘段至接收井' },
];

export const SHELL_PROCESS_OPTIONS: readonly ContextOption[] = [
  { id: 'PN-001', label: '工序 · 盾构始发' },
  { id: 'PN-002', label: '工序 · 变径段掘进' },
  { id: 'PN-003', label: '工序 · 站体衬砌' },
];
