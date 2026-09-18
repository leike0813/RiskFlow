// 汇报截图管线（M5）：从 v2 派生 5 张 1920×1080 汇报图。
// 派生点对齐产品规格 §18：
//   1. 风险态势总览        ← P-OV-01
//   2. 智能 Agent          ← P-AG-02 全屏工作台
//   3. 智能识别中心        ← P-RI-03 识别运行详情
//   4. 风险评估与预警中心  ← P-RA-05 + P-RA-06 + P-WR-01 组合视图
//   5. 风险详情/处置/追溯  ← P-RI-06 + P-WR-04 + P-RV-04 组合视图
// 产物约束：只含产品路由；#__review 与 gaps=on 不得出现在截取地址中，
// 页面文本不得出现缺口覆盖层内容（默认关闭，此处做断言）。
// 可重复执行：脚本自带静态服务起停，不依赖手工准备浏览器状态。
// 浏览器：优先本机 Playwright 缓存 chromium-1223，回退系统 google-chrome。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5320;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = new URL('../screenshots/', import.meta.url).pathname;
const CHROMIUM_CANDIDATES = [
  join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'),
  '/usr/bin/google-chrome',
];

// 五角色并集 + 强制 ready：截图呈现完整内容，与角色门控演示无关。
const ROLES = 'roles=project-risk-manager,engineering-data-steward,knowledge-engineer,field-responder,system-administrator';

const SHOTS = [
  ['01-risk-overview.png', '/overview'],
  ['02-agent-workbench.png', '/agent'],
  ['03-identification-run.png', '/identification/runs/RUN-20260827-001'],
  ['04-assessment-warning.png', '/compose/assessment-warning'],
  ['05-risk-response-trace.png', '/compose/trace'],
];

function resolveBrowser() {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('未找到可用浏览器：请安装 Playwright chromium 或系统 google-chrome');
}

async function waitForServer(url, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 服务尚未就绪
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务在预期时间内未就绪：${url}`);
}

// 产物约束断言：截取地址不得包含审阅设施。
for (const [name] of SHOTS) {
  if (name.includes('__review')) throw new Error('截图文件名不得指向审阅控制台');
}
for (const [, path] of SHOTS) {
  if (path.includes('__review') || path.includes('gaps=on')) {
    throw new Error(`截取地址违反产物约束：${path}`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

const server = spawn(process.execPath, [new URL('./serve.mjs', import.meta.url).pathname], {
  stdio: 'ignore',
});

let exitCode = 0;
try {
  await waitForServer(`${BASE}/`);
  const browser = await chromium.launch({ executablePath: resolveBrowser() });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    for (const [name, path] of SHOTS) {
      const url = `${BASE}/#${path}?state=ready&${ROLES}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      // 截图前移除主标题的程序化焦点（a11y 焦点环不属于视觉内容）。
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      const text = await page.textContent('body');
      if (text.includes('__review') || /GAP-\d{3}/.test(text)) {
        throw new Error(`页面文本含审阅设施内容，已中止：${path}`);
      }
      await page.screenshot({ path: join(OUT_DIR, name) });
      console.log(`已产出 ${name} ← ${path}`);
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);
