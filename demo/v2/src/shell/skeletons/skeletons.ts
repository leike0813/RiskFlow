// 骨架类型与元数据。五类基础骨架（A 列表 / B 详情 / C 运行 / D 治理 / E 复核）
// 对应生产 WebShellKindV1 的 list/detail/run/governance/review；
// AG Agent 专用与 A+C、A+B 复合骨架是 v2 的扩展预设（见 docs/GAP-LEDGER.md G1 类）。
// 三种页面形态（主从复合页 / KPI 横条网格 / 图谱画布）叠加在基础骨架之上。

export type SkeletonKind = 'A' | 'B' | 'C' | 'D' | 'E' | 'AG' | 'A+C' | 'A+B';

export type PageForm = 'standard' | 'master-detail' | 'kpi-grid' | 'graph-canvas';

export const SKELETON_KINDS: readonly SkeletonKind[] = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'AG',
  'A+C',
  'A+B',
];

export const SKELETON_LABELS: Readonly<Record<SkeletonKind, string>> = {
  A: 'A 列表',
  B: 'B 详情',
  C: 'C 运行',
  D: 'D 治理',
  E: 'E 复核',
  AG: 'AG Agent 专用',
  'A+C': 'A+C 复合（列表+运行）',
  'A+B': 'A+B 复合（列表+详情）',
};

export const PAGE_FORM_LABELS: Readonly<Record<PageForm, string>> = {
  standard: '标准单页',
  'master-detail': '主从复合页（左列表右详情）',
  'kpi-grid': 'KPI 横条网格',
  'graph-canvas': '图谱画布',
};
