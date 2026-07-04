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

本项目内置了 NeteaseCloudMusicApi 的完整备份，无需额外克隆即可一键启动。

### 方式一：使用内置备份（推荐）

```bash
# 1. 进入 API 备份目录
cd NeteaseCloudMusicApiBackup

# 2. 安装依赖（仅首次）
npm install

# 3. 启动 API 服务（默认监听 http://localhost:3000）
node app.js
```

### 方式二：克隆官方仓库

```bash
git clone https://github.com/Binaryify/NeteaseCloudMusicApi.git
cd NeteaseCloudMusicApi
npm install
node app.js
```

### 启动前端

API 启动后，直接用浏览器打开项目根目录下的 `index.html` 即可使用（API 默认为 `http://localhost:3000`，已配置在 `config.js` 中）。

> **⚠️ 注意**：前端文件（`index.html`）必须通过 `http://` 协议访问（如 `http://localhost/...`），直接双击用 `file://` 打开会导致跨域请求失败。建议使用 VS Code 的 Live Server 插件，或将文件部署到任意 HTTP 服务器。

## 完整启动流程（快速上手）

以下是从零开始使用本项目的完整步骤：

### 第一步：启动 API

```bash
# 在项目根目录下执行
cd NeteaseCloudMusicApiBackup

# 安装依赖（仅首次需要）
npm install

# 启动 API 服务（默认监听 http://localhost:3000）
node app.js
```

> API 启动后终端会持续运行，**不要关闭此终端**。保持此终端窗口运行。

### 第二步：启动前端

**方式 A：使用 VS Code Live Server（推荐）**

1. 在 VS Code 中安装 `Live Server` 插件（作者 Ritwick Dey）
2. 右键 `index.html` → **Open with Live Server**
3. 浏览器自动打开 `http://127.0.0.1:5500/index.html`

**方式 B：使用 serve 包**

```bash
# 另开一个终端，在项目根目录执行：
npx serve .
# 然后浏览器访问提示的地址（通常是 http://localhost:3000）
```

> 如果 `serve` 占用了 3000 端口（与 API 冲突），请改用 `npx serve . -p 8080`。

**方式 C：使用 Python（如已安装）**

```bash
# 另开一个终端，在项目根目录执行：
python -m http.server 8080
# 然后浏览器访问 http://localhost:8080
```

**方式 D：直接双击打开（不推荐 ⚠️）**

直接双击 `index.html` 用 `file://` 协议打开，可能导致跨域请求失败。如果尝试此方式后页面请求报错，请改用上述 HTTP 服务器方式。

### 第三步：使用

打开浏览器访问前端页面（根据第二步选择的地址），在输入框中输入网易云用户昵称或 UID 即可使用。


## 项目结构

```
├── index.html                          # 页面结构
├── style.css                           # 样式
├── app.js                              # 核心逻辑
├── config.js                           # 配置文件（API地址、拆分阈值等）
├── .gitignore                          # Git 忽略规则
├── README.md                           # 本文件
└── NeteaseCloudMusicApiBackup/         # NeteaseCloudMusicApi 完整备份
    ├── app.js                          # API 启动入口
    ├── package.json                    # 依赖配置
    ├── module/                         # 各 API 路由模块
    ├── util/                           # 工具函数
    ├── public/                         # 静态资源
    ├── data/                           # 缓存数据
    └── ...
```
