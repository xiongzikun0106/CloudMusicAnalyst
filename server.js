/**
 * VPS 后端 API — 歌单品味锐评助手
 */

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const NCM_API_BASE = 'http://ncm:3000';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const NCM_PROXY_PATHS = ['/user/playlist', '/playlist/track/all', '/get/userids'];
app.all(NCM_PROXY_PATHS, async (req, res) => {
  try {
    const targetUrl = `${NCM_API_BASE}${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let body = null;
    if (req.method === 'POST') {
      body = await new Promise(resolve => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); });
    }
    const proxyRes = await fetch(targetUrl, { method: req.method, headers, body });
    const data = await proxyRes.json();
    res.status(proxyRes.status).json(data);
  } catch (err) {
    res.status(500).json({ code: 500, msg: err.message });
  }
});

app.get('/user/full-review', async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ error: '缺少 uid 参数' });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const plRes = await fetch(`${NCM_API_BASE}/user/playlist?uid=${encodeURIComponent(uid)}`, { headers });
    const plData = await plRes.json();
    if (plData.code !== 200) throw new Error(plData.msg || '获取歌单失败');
    const playlists = (plData.playlist || []).filter(p =>
      String(p.userId) === String(uid) || (p.creator && String(p.creator.userId) === String(uid))
    );

    const prompt = `【请锐评以下音乐品味】\n数据格式：JSON 对象 {playlists:[{name, trackCount},...]}\n\n${JSON.stringify({playlists: playlists.map(p => ({name: p.name, trackCount: p.trackCount}))})}\n\n---\n请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价。`;

    res.json({ code: 200, playlistCount: playlists.length, albumCount: 0, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai-review', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传提示词文件' });
    const text = req.file.buffer.toString('utf-8');
    const model = req.body.model || 'deepseek-v4-flash';

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一个音乐品味锐评人。用户给你 JSON 格式的歌单数据，请从音乐品味、风格偏好、年代分布等角度输出 200-500 字中文评价，毒舌幽默但不失礼貌。' },
          { role: 'user', content: text },
        ],
        max_tokens: 1024,
        temperature: 0.8,
        thinking: { type: 'disabled' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek API 错误 (${response.status}): ${errText}` });
    }
    const data = await response.json();
    res.json({ reply: data.choices?.[0]?.message?.content || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ code: 404, msg: 'Not Found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));