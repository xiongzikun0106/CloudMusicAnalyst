/**
 * 本地开发服务器 — 静态文件 + API 代理到 FastAPI (后端容器端口 8000)
 *
 * 用法：
 *   1. 在 VPS 或本地启动后端：python -m uvicorn backend.main:app --port 8000
 *   2. 启动本前端：node serve.js
 *   3. 浏览器打开 http://localhost:8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API 代理（/api、/user、/playlist、/get、/search、/song）
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/user/') ||
      url.pathname.startsWith('/playlist/') ||
      url.pathname.startsWith('/get/') ||
      url.pathname.startsWith('/search') ||
      url.pathname.startsWith('/song/')) {
    proxy(req, res, url);
    return;
  }

  // 静态文件
  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

function proxy(req, res, url) {
  const target = new URL(url.pathname + url.search, API_TARGET);
  const headers = { ...req.headers, host: target.host };
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req;

  const proxyReq = http.request(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: '后端连接失败: ' + err.message }));
  });
  if (body) body.pipe(proxyReq);
  else proxyReq.end();
}

server.listen(PORT, () => {
  console.log(`Frontend server running at http://localhost:${PORT}`);
  console.log(`API proxy → ${API_TARGET}`);
});