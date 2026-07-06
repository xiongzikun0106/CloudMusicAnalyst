# 🎵 歌单品味锐评助手

输入网易云用户 ID，自动生成 AI 锐评提示词。

## 功能

- **搜索用户** — 支持昵称模糊搜索或 UID 精确查询
- **选择歌单** — 单选模式，每次只选一个
- **导出提示词** — 复制（≤100 首）或下载 TXT
- **AI 锐评** — 一键发送给 DeepSeek，自动生成毒舌锐评（需部署 Worker）
- **深色模式** — 右上角切换，自动记住偏好

## 快速开始

```bash
# 1. 启动本地 API
cd NeteaseCloudMusicApiBackup
npm install && node app.js

# 2. 启动前端（另一个终端）
python -m http.server 8080

# 3. 浏览器打开 http://localhost:8080
```

> ⚠️ 前端必须通过 `http://` 访问，不要直接双击 `index.html`。

## 项目结构

```
├── index.html        # 页面结构
├── style.css         # 样式（深色模式支持）
├── app.js            # 核心逻辑
├── config.js         # 配置文件
├── api/index.js      # Cloudflare Worker（API 代理 + AI 锐评）
├── wrangler.toml     # Workers 配置
├── DEPLOY.md         # Cloudflare 完整部署文档 ← 部署前必看
├── NeteaseCloudMusicApiBackup/  # API 备份仓库
│   └── ...
└── .github/workflows/deploy.yml  # GitHub Actions 自动部署
```

## 演示地址

🌐 前端：**https://cloudmusicanalyst.net**

## 许可证
- 本项目使用MIT许可证


## 致谢

- 网易云音乐 API 备份仓库：[nooblong/NeteaseCloudMusicApiBackup](https://github.com/nooblong/NeteaseCloudMusicApiBackup)
- 原始 API 项目：[Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
