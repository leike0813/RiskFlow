// 红线校验：依赖边界、测试文件命名、用户可见文案、57 页覆盖。
// 运行：node tools/check-redlines.check.mjs（经 npm run check）。

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const v2Root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (['node_modules', 'dist', 'screenshots'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// 1. 不得出现 .test. / .spec. 命名（根 vitest 默认 glob 会扫到 demo/**）。
for await (const file of walk(v2Root)) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    failures.push(`禁止的测试命名：${relative(v2Root, file)}`);
  }
}

// 2. src/ 依赖白名单：仅 react / react-dom；其余一律相对路径。
const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
for await (const file of walk(join(v2Root, 'src'))) {
  if (!/\.[jt]sx?$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || specifier.startsWith('.') ) continue;
    if (specifier !== 'react' && specifier !== 'react-dom' && !specifier.startsWith('react/') && !specifier.startsWith('react-dom/')) {
      failures.push(`src/ 引入白名单外依赖「${specifier}」：${relative(v2Root, file)}`);
    }
  }
}

// 3. 用户可见文案红线（AGENTS.md §8）：页面与内容层不得出现实现名与临时措辞。
const FORBIDDEN_COPY = [
  /identificationGraph/,
  /assessmentGraph/,
  /riskFlowGraph/,
  /TODO/,
  /FIXME/,
  /\bMock\b/i,
  /占位/,
  /兼容性说明/,
];
for (const dir of ['src/pages', 'src/content', 'src/shell', 'src/components']) {
  for await (const file of walk(join(v2Root, dir))) {
    if (!/\.[jt]sx?$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_COPY) {
      if (pattern.test(source)) {
        failures.push(`文案红线 ${pattern} 命中：${relative(v2Root, file)}`);
      }
    }
  }
}

// 4. 57 页覆盖：docs/page-manifest.json 是页面单一事实源（路由由它程序化生成）。
//    校验清单自身一致性、取值词汇（branch / capability 对齐 contract-mirror）、
//    以及 11 个域路由模块与聚合文件齐备。
const EXPECTED_DOMAINS = [
  'overview', 'project', 'knowledge', 'identification', 'assessment',
  'warning', 'response', 'agent', 'review', 'report', 'ops',
];
const EXPECTED_SKELETONS = ['A', 'B', 'C', 'D', 'E', 'AG', 'A+C', 'A+B'];
try {
  const manifest = JSON.parse(
    await readFile(join(v2Root, 'docs/page-manifest.json'), 'utf8'),
  );
  const mirror = JSON.parse(
    await readFile(join(v2Root, 'src/app/contract-mirror.data.json'), 'utf8'),
  );
  const branches = new Set(Object.keys(mirror.branchCapability));
  const capabilities = new Set(mirror.capabilities);
  const pages = manifest.pages ?? [];

  if (pages.length !== 57) failures.push(`page-manifest 页数 ${pages.length} ≠ 57`);

  for (const key of ['pageId', 'routeId', 'path', 'samplePath']) {
    const seen = new Set();
    for (const page of pages) {
      if (seen.has(page[key])) failures.push(`page-manifest ${key} 重复：${page[key]}`);
      seen.add(page[key]);
    }
  }

  for (const page of pages) {
    if (!EXPECTED_DOMAINS.includes(page.domain)) {
      failures.push(`${page.pageId} 域未知：${page.domain}`);
    }
    if (!EXPECTED_SKELETONS.includes(page.skeleton)) {
      failures.push(`${page.pageId} 骨架未知：${page.skeleton}`);
    }
    if (page.branch !== null && !branches.has(page.branch)) {
      failures.push(`${page.pageId} branch 不在 53 个取值内：${page.branch}`);
    }
    if (page.capability !== null && !capabilities.has(page.capability)) {
      failures.push(`${page.pageId} capability 不在 29 个取值内：${page.capability}`);
    }
    if (typeof page.change !== 'string' || page.change.trim() === '') {
      failures.push(`${page.pageId} 缺归属 change 标注`);
    }
  }

  for (const domain of EXPECTED_DOMAINS) {
    const modulePath = join(v2Root, 'src/pages', domain, 'routes.tsx');
    const source = await readFile(modulePath, 'utf8').catch(() => null);
    if (source === null) {
      failures.push(`缺域路由模块：src/pages/${domain}/routes.tsx`);
    } else if (!source.includes(`routesForDomain('${domain}')`)) {
      failures.push(`src/pages/${domain}/routes.tsx 未调用 routesForDomain('${domain}')`);
    }
  }

  const aggregate = await readFile(join(v2Root, 'src/pages/routes.tsx'), 'utf8');
  for (const domain of EXPECTED_DOMAINS) {
    if (!aggregate.includes(`./${domain}/routes`)) {
      failures.push(`src/pages/routes.tsx 未聚合 ${domain} 域路由`);
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  failures.push('docs/page-manifest.json 缺失（M2 起必须具备）');
}

if (failures.length > 0) {
  console.error(`红线校验失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('红线校验通过：命名、依赖边界、文案红线、页面覆盖。');
