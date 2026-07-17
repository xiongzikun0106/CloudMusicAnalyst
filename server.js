/**
 * VPS 后端 API — 歌单品味锐评助手
 * 
 * 路由：
 *   /user/playlist?uid=xxx    → 代理到 NeteaseCloudMusicApi
 *   /playlist/track/all?id=xxx → 代理到 NeteaseCloudMusicApi
 *   /get/userids?nicknames=xxx → 代理到 NeteaseCloudMusicApi
 *   /api/ai-review             → 调用 DeepSeek API（POST FormData）
 */

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// NeteaseCloudMusicApi 部署地址
const NCM_API_BASE = 'http://ncm:3000';

// DeepSeek API Key（优先环境变量，回退硬编码）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// CORS 中间件
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 代理网易云 API
const NCM_PROXY_PATHS = ['/user/playlist', '/playlist/track/all', '/get/userids'];

app.all(NCM_PROXY_PATHS, async (req, res) => {
  try {
    const targetUrl = `${NCM_API_BASE}${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let body = null;
    if (req.method === 'POST') {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
      });
    }
    const proxyRes = await fetch(targetUrl, { method: req.method, headers, body });
    const data = await proxyRes.json();
    res.status(proxyRes.status).json(data);
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// AI 锐评
app.post('/api/ai-review', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传提示词 TXT 文件' });
    }
    const text = req.file.buffer.toString('utf-8');
    const model = req.body.model || 'deepseek-v4-flash';

    const messages = [
      {
        role: 'system',
        content: '你是一个音乐品味锐评人。用户会给你一份歌单（歌曲名 - 歌手格式），请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣、有洞察力的评价。用中文回复，风格幽默犀利但不失礼貌。篇幅在 200-500 字之间。',
      },
      { role: 'user', content: text },
    ];

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1024,
        temperature: 0.8,
        stream: false,
        thinking: { type: 'disabled' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek API 错误 (${response.status}): ${errText}` });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, msg: 'Not Found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});