// 缺口台账的单一维护点：gap-ledger.data.json。
// 应用（审阅控制台、?gaps=on 覆盖层）与工具脚本（tools/build-gap-docs.mjs、
// tools/check-gaps.check.mjs）共用这份数据；docs/gaps/ 与 docs/GAP-LEDGER.md
// 由工具脚本从本数据生成，禁止手工改文档后不回写。

import data from './gap-ledger.data.json';

export type GapCategory = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';

export interface GapEntry {
  readonly id: string;
  readonly category: GapCategory;
  /** 缺口：一句话描述 */
  readonly title: string;
  /** 依据：哪条规格/契约/文档缺失或冲突，附路径与行号 */
  readonly basis: string;
  /** 预设：v2 采用的设计决定 */
  readonly preset: string;
  /** 待确认：将来由哪个 change 或谁裁决 */
  readonly pending: string;
  /** 风险：预设被推翻时的影响面 */
  readonly risk: string;
  /** 相关页面；空数组表示全局缺口 */
  readonly pageIds?: readonly string[];
}

export const GAP_CATEGORY_LABELS: Readonly<Record<string, string>> = data.categories;

export const GAPS: readonly GapEntry[] = data.gaps as readonly GapEntry[];

export function gapsForPage(pageId: string): readonly GapEntry[] {
  return GAPS.filter((gap) => (gap.pageIds ?? []).includes(pageId));
}

export function gapCountForPage(pageId: string): number {
  return gapsForPage(pageId).length;
}
