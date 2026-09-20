// 审阅 Harness 静态服务：服务 dist/，绑定 0.0.0.0:5320（严格端口，占用即失败）。
// 用法：npm run review（= 构建 + 本脚本）。Ctrl+C 停止。

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.REVIEW_HOST ?? '0.0.0.0';
const PORT = Number(process.env.REVIEW_PORT ?? 5320);
const ROOT = fileURLToPath(new URL('../dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://internal');
    let filePath = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RiskFlow v2 审阅 Harness 已启动：http://${HOST}:${PORT}/`);
  console.log('审阅控制台：#/ 路径后接 __review（例如 http://<本机IP>:5320/#/__review）');
  console.log('按 Ctrl+C 停止。');
});

server.on('error', (error) => {
  console.error(`启动失败：${error.message}`);
  console.error(`端口 ${PORT} 被占用或不可绑定；本脚本使用严格端口，不会自动换端口。`);
  process.exit(1);
});
