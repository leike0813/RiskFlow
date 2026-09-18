// 从 src/review/gap-ledger.data.json 生成 docs/GAP-LEDGER.md 与 docs/gaps/GAP-*.md。
// 用法：node tools/build-gap-docs.mjs

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGapFile, renderLedger } from './gap-docs.mjs';

const v2Root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(
  await readFile(join(v2Root, 'src/review/gap-ledger.data.json'), 'utf8'),
);

const docsDir = join(v2Root, 'docs');
const gapsDir = join(docsDir, 'gaps');
await mkdir(gapsDir, { recursive: true });

for (const entry of await readdir(gapsDir)) {
  if (/^GAP-\d+\.md$/.test(entry)) await rm(join(gapsDir, entry));
}

for (const gap of data.gaps) {
  await writeFile(join(gapsDir, `${gap.id}.md`), renderGapFile(gap, data.categories), 'utf8');
}
await writeFile(join(docsDir, 'GAP-LEDGER.md'), renderLedger(data), 'utf8');

console.log(`缺口台账文档已生成：${data.gaps.length} 条 → docs/GAP-LEDGER.md + docs/gaps/`);
