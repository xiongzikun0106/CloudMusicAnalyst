# 歌单品味锐评助手 🎵

> 输入网易云用户 ID，自动生成 AI 锐评提示词

## 功能

1. **输入用户 ID** → 查询该用户的所有公开歌单
2. **选择歌单** → 可多选，自动合并去重
3. **生成提示词** → 格式为 `歌曲名 - 歌手`，超过 200 首自动拆分
4. **倒序复制** → 拆分的片段按倒序排列，从上到下依次复制粘贴即可
5. **导出 TXT** → 一键导出完整提示词为文本文件

## 部署方式

### 前置条件

- 服务器需要运行 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
- 建议使用 Node.js v18+

### 部署步骤

1. **克隆项目到服务器**
2. **修改 `config.js`** 中的 `API_BASE_URL` 为你的 NeteaseCloudMusicApi 地址
3. **启动 NeteaseCloudMusicApi**（建议使用 pm2 守护进程）
4. **使用 nginx 反向代理**（推荐）或直接访问

### nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 静态文件（本项目）
    root /path/to/your/project;
    index index.html;

    # API 反向代理
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 代理 NeteaseCloudMusicApi
    location /user/playlist {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /playlist/track/all {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **提示**：如果使用独立域名/端口运行 API，只需修改 `config.js` 中的 `API_BASE_URL` 即可，无需 nginx 反向代理配置。

## 本地开发

1. 克隆 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 并启动：
   ```bash
   git clone https://github.com/Binaryify/NeteaseCloudMusicApi.git
   cd NeteaseCloudMusicApi
   npm install
   node app.js
   ```

2. 直接用浏览器打开 `index.html` 即可使用（API 默认运行在 `localhost:3000`）

## 项目结构

```
├── index.html      # 页面结构
├── style.css       # 样式
├── app.js          # 核心逻辑
├── config.js       # 配置文件（API地址、拆分阈值等）
├── .gitignore      # Git 忽略规则
└── README.md       # 本文件