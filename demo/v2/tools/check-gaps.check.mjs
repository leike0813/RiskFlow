// 缺口台账校验：
// 1. gap-ledger.data.json 结构合法（ID 连续、五字段非空、类别已知、pageIds 存在于清单）；
// 2. docs/GAP-LEDGER.md 与 docs/gaps/GAP-*.md 和数据文件同步（工具生成，禁止手改漂移）。
// 运行：node tools/check-gaps.check.mjs（经 npm run check）。

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGapFile, renderLedger } from './gap-docs.mjs';

const v2Root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

const data = JSON.parse(
  await readFile(join(v2Root, 'src/review/gap-ledger.data.json'), 'utf8'),
);
const manifest = JSON.parse(
  await readFile(join(v2Root, 'docs/page-manifest.json'), 'utf8'),
);
const pageIds = new Set(manifest.pages.map((page) => page.pageId));

// 1. 结构校验
data.gaps.forEach((gap, index) => {
  const expectedId = `GAP-${String(index + 1).padStart(3, '0')}`;
  if (gap.id !== expectedId) failures.push(`缺口 ID 不连续：期望 ${expectedId}，实际 ${gap.id}`);
  if (!data.categories[gap.category]) failures.push(`${gap.id} 类别未知：${gap.category}`);
  for (const field of ['title', 'basis', 'preset', 'pending', 'risk']) {
    if (typeof gap[field] !== 'string' || gap[field].trim() === '') {
      failures.push(`${gap.id} 字段 ${field} 为空`);
    }
  }
  for (const pageId of gap.pageIds ?? []) {
    if (!pageIds.has(pageId)) failures.push(`${gap.id} 引用了未登记页面 ${pageId}`);
  }
});

// 2. 文档同步校验
const ledgerExpected = renderLedger(data);
const ledgerActual = await readFile(join(v2Root, 'docs/GAP-LEDGER.md'), 'utf8').catch(() => null);
if (ledgerActual !== ledgerExpected) {
  failures.push('docs/GAP-LEDGER.md 与 gap-ledger.data.json 不同步（运行 node tools/build-gap-docs.mjs）');
}

const gapFiles = await readdir(join(v2Root, 'docs/gaps')).catch(() => []);
const expectedFiles = new Set(data.gaps.map((gap) => `${gap.id}.md`));
for (const file of gapFiles) {
  if (/^GAP-\d+\.md$/.test(file) && !expectedFiles.has(file)) {
    failures.push(`docs/gaps/${file} 无对应台账条目`);
  }
}
for (const gap of data.gaps) {
  const actual = await readFile(join(v2Root, 'docs/gaps', `${gap.id}.md`), 'utf8').catch(() => null);
  if (actual !== renderGapFile(gap, data.categories)) {
    failures.push(`docs/gaps/${gap.id}.md 与 gap-ledger.data.json 不同步`);
  }
}

if (failures.length > 0) {
  console.error(`缺口台账校验失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`缺口台账校验通过：${data.gaps.length} 条，文档同步。`);
