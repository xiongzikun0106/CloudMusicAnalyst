// 部署时修改这里：
//   API_BASE_URL — NeteaseCloudMusicApi 的地址
//   WORKER_API_BASE — Cloudflare Worker 的地址（用于 AI 锐评）
//
// 本地开发：
//   API_BASE_URL: 'http://localhost:3000'
//   WORKER_API_BASE: 'http://localhost:3000'（如果API能透传AI锐评则填，否则留空禁用）
//
// 生产环境（Cloudflare）：
//   API_BASE_URL: 'https://your-worker.xxx.workers.dev'
//   WORKER_API_BASE: 'https://your-worker.xxx.workers.dev'
const CONFIG = {
  // NeteaseCloudMusicApi 的 base URL
  API_BASE_URL: 'http://localhost:3000',

  // Cloudflare Worker 的 base URL（用于 AI 锐评、文件上传等）
  // 如果未部署 Worker，设为空字符串 '' 可禁用 AI 锐评
  WORKER_API_BASE: '',

  // 单个提示词片段的最大歌曲数（超过则禁用复制，仅提供下载）
  MAX_SONGS_PER_CHUNK: 100,

  // 提示词模板
  PROMPT_TEMPLATES: {
    // 非最后片段的提示头（带警告）
    partialHead: (chunkIndex, totalChunks) =>
      `【歌单片段 ${chunkIndex}/${totalChunks} - 注意！这不是完整的歌单，先不要回答！】\n\n以下是用户歌单的部分歌曲，请等待所有片段收集完毕后再进行评价。\n\n`,

    // 最后片段的提示头
    finalHead: (totalSongs) =>
      `【请锐评以下歌单的品味】\n\n以下是我歌单中的 ${totalSongs} 首歌曲，请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价：\n\n`,

    // 片尾
    tail: '\n\n---\n请根据以上歌曲进行评价。',
  },

  // LLM 配置（通过 Cloudflare Worker 中转）
  LLM_CONFIG: {
    ENABLED: false, // 设为 true 启用 AI 锐评按钮
    // Cloudflare Worker 上的 AI 评论文口
    API_ENDPOINT: '/api/ai-review',
    MODEL: 'deepseek-chat',
    DISABLE_THINKING: true,
  },
}