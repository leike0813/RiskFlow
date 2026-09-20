// 缺口台账文档生成器：src/review/gap-ledger.data.json（单一维护点）→
// docs/GAP-LEDGER.md 与 docs/gaps/GAP-*.md。
// 被 tools/build-gap-docs.mjs（写入）与 tools/check-gaps.check.mjs（比对）共用。

export function renderGapFile(gap, categories) {
  const pages = (gap.pageIds ?? []).length > 0 ? gap.pageIds.join('、') : '全局';
  return `# ${gap.id} ${gap.title}

- 类别：${gap.category} ${categories[gap.category] ?? ''}
- 相关页面：${pages}

## 缺口

${gap.title}

## 依据

${gap.basis}

## 预设

${gap.preset}

## 待确认

${gap.pending}

## 风险

${gap.risk}
`;
}

export function renderLedger(data) {
  const { categories, gaps } = data;
  const lines = [
    '# 缺口台账（GAP LEDGER）',
    '',
    '> 单一维护点：`src/review/gap-ledger.data.json`。本文件与 `docs/gaps/` 由',
    '> `node tools/build-gap-docs.mjs` 生成，禁止手工编辑；`npm run check` 校验同步。',
    '',
    `共 ${gaps.length} 条。每条五字段：缺口 / 依据（附路径行号）/ 预设 / 待确认 / 风险。`,
    '',
    '| ID | 类别 | 缺口 | 相关页面 |',
    '|---|---|---|---|',
  ];
  for (const gap of gaps) {
    const pages = (gap.pageIds ?? []).length > 0 ? gap.pageIds.join('、') : '全局';
    lines.push(
      `| [${gap.id}](gaps/${gap.id}.md) | ${gap.category} ${categories[gap.category] ?? ''} | ${gap.title} | ${pages} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
