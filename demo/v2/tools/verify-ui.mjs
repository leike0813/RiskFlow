// PROTOTYPE · THROWAWAY — 一次性验证：27 个页面全部渲染 + 禁用词扫描。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const resolveBrowser = () => {
  const c = [
    join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const hit = c.find((p) => existsSync(p));
  if (!hit) throw new Error('未找到浏览器');
  return hit;
};

const PAGES = [
  'overview', 'engineering', 'documentList', 'documentDetail', 'monitoringList',
  'monitoringDetail', 'idRunList', 'idRunDetail', 'riskRecordList', 'riskRecordDetail',
  'graph', 'processModel', 'pendingAssessment', 'assessmentList', 'assessmentDetail',
  'assessmentMatrix', 'warningCenter', 'warningDetail', 'responseTaskList',
  'responseTaskDetail', 'mechanism', 'ruleSet', 'indicatorSystem', 'measure',
  'governanceMatrix', 'auditLog', '__shortcuts',
];

const browser = await chromium.launch({ executablePath: resolveBrowser() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const base = 'http://127.0.0.1:5320/#/prototype/ui?p=';

let bad = 0;
for (const p of PAGES) {
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.waitForSelector('.dl-page, .dl-shortcuts', { timeout: 5000 });
  const h1 = (await page.textContent('.dl-h1').catch(() => '')) ?? '';
  const rows = await page.$$eval('.dl-table tbody tr', (n) => n.length);
  const risks = await page.$$eval('.dl-risk', (n) => n.length);
  const agents = await page.$$eval('.dl-agent', (n) => n.length);
  const ids = await page.$$eval('.dl-mono', (n) => n.length);
  const txt = await page.textContent('.dl');
  const banned = ['JSON', 'Schema', '游标', '投影', '幂等', 'runId', '发布集合', 'I0–I9']
    .filter((w) => txt.includes(w));
  if (banned.length) bad += 1;
  console.log(
    `${p.padEnd(20)} h1="${h1.trim().slice(0, 26)}" 表行=${String(rows).padStart(3)} 风险徽章=${String(risks).padStart(2)} Agent=${agents} ID区=${ids}${banned.length ? '  ⚠禁用词:' + banned.join(',') : ''}`,
  );
}

// 命令面板与快捷键
await page.goto(base + 'overview', { waitUntil: 'networkidle' });
await page.keyboard.press('Control+k');
await page.waitForSelector('.dl-cmdk', { timeout: 3000 });
console.log('⌘K 面板项数 =', await page.$$eval('.dl-cmdk-item', (n) => n.length));
await page.keyboard.type('处置');
await page.waitForTimeout(200);
console.log('⌘K 输入「处置」后项数 =', await page.$$eval('.dl-cmdk-item', (n) => n.length));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
console.log('Esc 关闭 =', (await page.$('.dl-cmdk')) === null ? 'OK' : '未关闭');

await page.goto(base + 'overview', { waitUntil: 'networkidle' });
await page.keyboard.press('g');
await page.keyboard.press('5');
await page.waitForTimeout(300);
console.log('g 5 →', page.url().split('p=')[1]);

for (const p of ['overview', 'responseTaskDetail', 'assessmentDetail', 'warningCenter']) {
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `/tmp/ui-${p}.png`, fullPage: true });
}
console.log('截图: /tmp/ui-overview.png /tmp/ui-responseTaskDetail.png /tmp/ui-assessmentDetail.png /tmp/ui-warningCenter.png');
console.log(bad === 0 ? '全部页面无禁用词' : `${bad} 个页面含禁用词`);
await browser.close();
