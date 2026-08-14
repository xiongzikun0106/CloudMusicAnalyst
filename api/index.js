/**
 * Cloudflare Worker — 歌单品味锐评助手 API
 * 
 * 路由：
 *   /user/playlist?uid=xxx    → 代理到 NeteaseCloudMusicApi
 *   /playlist/track/all?id=xxx → 代理到 NeteaseCloudMusicApi
 *   /get/userids?nicknames=xxx → 代理到 NeteaseCloudMusicApi
 *   /api/ai-review             → 调用 DeepSeek API（POST FormData）
 * 
 * NeteaseCloudMusicApi 备份仓库（部署时 fork 到 Render）：
 *   https://github.com/nooblong/NeteaseCloudMusicApiBackup
 * 
 * 部署：
 *   1. npm install -g wrangler
 *   2. wrangler deploy
 *   3. 在 Cloudflare Dashboard 设置 DEEPSEEK_API_KEY 环境变量
 */

// NeteaseCloudMusicApi 部署地址 —— 生产环境请在 Cloudflare Dashboard 设置
// NCM_API_BASE 环境变量，不要硬编码在代码/仓库里
const NCM_PROXY_PATHS = ['/user/playlist', '/playlist/track/all', '/get/userids'];

// 允许用户选择的模型白名单（防止被指定为更贵的模型刷费用）
const ALLOWED_MODELS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/ai-review') {
        return await handleAiReview(request, env, corsHeaders);
      }
      if (NCM_PROXY_PATHS.includes(path)) {
        return await handleNcmProxy(request, env, path, url.search, corsHeaders);
      }
      return new Response(JSON.stringify({ code: 404, msg: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ code: 500, msg: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

async function handleNcmProxy(request, env, path, query, corsHeaders) {
  const NCM_API_BASE = env.NCM_API_BASE || '';
  if (!NCM_API_BASE) {
    return new Response(JSON.stringify({ code: 500, msg: 'NCM_API_BASE 未配置' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const targetUrl = `${NCM_API_BASE}${path}${query}`;
  const proxyHeaders = new Headers();
  proxyHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
  let body = null;
  if (request.method === 'POST') {
    body = await request.text();
  }
  const proxyRequest = new Request(targetUrl, {
    method: request.method || 'POST',
    headers: proxyHeaders,
    body: body,
  });
  const response = await fetch(proxyRequest);
  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * AI 锐评 — 上传 TXT 提示词 → DeepSeek API
 * 模型: deepseek-v4-flash，禁用思考
 */
async function handleAiReview(request, env, corsHeaders) {
  // 优先从环境变量读取 API Key，没有则回退到硬编码
  const API_KEY = env.DEEPSEEK_API_KEY;

  const formData = await request.formData();
  const file = formData.get('file');
  const modelRaw = formData.get('model');
  const model = ALLOWED_MODELS.includes(modelRaw) ? modelRaw : 'deepseek-v4-flash';

  if (!file) {
    return new Response(
      JSON.stringify({ error: '请上传提示词 TXT 文件' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const text = await file.text();

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
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: 1024,
      temperature: 0.8,
      stream: false,
      thinking: { type: 'disabled' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return new Response(
      JSON.stringify({ error: `DeepSeek API 错误 (${response.status}): ${errText}` }),
      { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '';

  return new Response(JSON.stringify({ reply }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}