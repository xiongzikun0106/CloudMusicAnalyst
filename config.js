// 部署时修改这里：
//   API_BASE_URL — Cloudflare Worker 地址（前端通过 Worker 访问一切）
//   WORKER_API_BASE — 同上
//
// 本地开发：
//   API_BASE_URL: 'http://localhost:3000'
//   WORKER_API_BASE: 'http://localhost:3000'
//
// 生产环境（使用自定义域名）：
//   API_BASE_URL: 'https://api.cloudmusicanalyst.net'
//   WORKER_API_BASE: 'https://api.cloudmusicanalyst.net'
const CONFIG = {
  // Cloudflare Worker 地址（通过自定义域名访问）
  API_BASE_URL: 'https://api.cloudmusicanalyst.net',

  // 同上（Worker 同时处理 API 代理和 AI 锐评）
  WORKER_API_BASE: 'https://api.cloudmusicanalyst.net',

  // 单个提示词片段的最大歌曲数（超过则禁用复制，仅提供下载）
  MAX_SONGS_PER_CHUNK: 100,

  // 提示词模板
  PROMPT_TEMPLATES: {
    partialHead: (chunkIndex, totalChunks) =>
      `【歌单片段 ${chunkIndex}/${totalChunks} - 注意！这不是完整的歌单，先不要回答！】\n\n以下是用户歌单的部分歌曲，请等待所有片段收集完毕后再进行评价。\n\n`,
    finalHead: (totalSongs) =>
      `【请锐评以下歌单的品味】\n\n以下是我歌单中的 ${totalSongs} 首歌曲，请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价：\n\n`,
    tail: '\n\n---\n请根据以上歌曲进行评价。',
  },

  // LLM 配置（通过 Cloudflare Worker 中转）
  LLM_CONFIG: {
    ENABLED: true,
    API_ENDPOINT: '/api/ai-review',
    MODEL: 'deepseek-v4-flash',
    DISABLE_THINKING: true,
  },
}