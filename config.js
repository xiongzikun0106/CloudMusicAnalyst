// 部署时修改这里：NeteaseCloudMusicApi 的地址
// 本地开发：http://localhost:3000
// 云服务器：http://你的服务器IP:3000 或 https://你的域名/api（如果用了反向代理）
const CONFIG = {
  // NeteaseCloudMusicApi 的 base URL
  API_BASE_URL: 'http://localhost:3000',

  // 单个提示词片段的最大歌曲数（超过则拆分）
  MAX_SONGS_PER_CHUNK: 200,

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
}