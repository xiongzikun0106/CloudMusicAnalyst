# 🎵 云音乐趣味工坊

一站式网易云娱乐工具：**战斗 BGM 属性卡生成器** + **歌单品味锐评助手**。

- ⚔️ **战斗 BGM 属性卡** — 输入歌名/链接，自动分析音频 + 歌词，生成一张战斗属性卡（系别、攻速、爆发力、蓄力、冷却、技能），并与历史 100 份卡片对比输出「排面」，再由 LLM 生成一段基于属性/歌词/排面的**毒舌本场战报锐评**（可一键换一个角度再评）。
- 🎯 **歌单品味锐评** — 输入网易云用户 ID/昵称，自动生成 AI 毒舌锐评提示词，或一键发送给 DeepSeek 生成锐评。

---

## 功能总览

| 功能 | 说明 |
|---|---|
| 战斗 BGM 属性卡 | 歌名/链接/ID → 属性卡 JSON（含排面排名/百分位/系别分布）+ 能量波形图 + 冷却倒计时 |
| 本场战报锐评 | DeepSeek 基于「属性 + 歌词 + 排面」生成毒舌锐评；「🔄 再评一次」可换角度重生成（不重新分析/不写缓存） |
| 歌单锐评 | 昵称模糊搜索 / UID 精确查询 → 选择歌单 → 生成提示词 → 复制/下载 TXT / AI 锐评 |
| 全员锐评 | 一键锐评用户所有歌单 |
| 排行面板 | 查看当前缓存中各维度 TOP 20 排行榜（综合战力/攻速/爆发力/BPM/副歌占比/冷却） |
| 深色模式 | 右上角切换，自动记忆偏好 |

---

## 快速启动（VPS 生产）

VPS 上部署为 **2 个 Docker 容器**：

- `backend` 容器：内置 **NeteaseCloudMusicApi**（Node，端口 3000）+ **FastAPI**（Python，端口 8000），API Key 从 VPS 环境变量读取
- `frontend` 容器：Nginx 静态文件，反向代理 `/api` 等路径到 backend

```bash
# 1. 在 VPS 上准备好 .env（内容见 .env.example）
#    DEEPSEEK_API_KEY=xxx
#    TUNNEL_TOKEN=xxx   （Cloudflare Tunnel）

# 2. 构建并启动
docker compose up -d --build

# 3. 通过 Cloudflare Tunnel 暴露
#    http://cloudmusicanalyst.net （前端）
#    或你配置的域名
```

> ⚠️ `DEEPSEEK_API_KEY` 已作为环境变量存于 VPS，无需写入代码。

---

## 快速启动（本地开发）

```bash
# 1. 准备网易云 API（任选一种）
#    方式 A：本地克隆并启动
git clone https://github.com/nooblong/NeteaseCloudMusicApiBackup.git
cd NeteaseCloudMusicApiBackup && npm install && node app.js   # 端口 3000

#    方式 B：仅启动后端容器（内置 NCM API）
docker compose up -d backend

# 2. 安装 Python 依赖并启动 FastAPI
#    需先设置 DEEPSEEK_API_KEY（如已注入 VPS 则非必需）
set DEEPSEEK_API_KEY=sk-xxx
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --port 8000

# 3. 启动前端开发服务器（静态文件 + API 代理到 8000）
node serve.js
# 浏览器打开 http://localhost:8080
```

---

## 命令行 Demo

```bash
# 分析一首歌并输出完整属性卡 JSON
python scripts/analyze.py "孤勇者"
python scripts/analyze.py "https://music.163.com/song?id=xxxx"
python scripts/analyze.py "123456"   # 纯歌曲 ID

# 缓存造数（验证 FIFO 裁剪，注入 120 份 -> 缓存保留 100 份）
python scripts/seed_cache.py --count 120 --clear

# 排面单元测试
python scripts/test_ranking.py
```

---

## 战斗 BGM 属性卡核心规则

1. **冷却时间 = 歌曲完整时长**。<1 分钟的歌不允许参战（接口返回明确错误）。
2. **系别**（火/水/风/雷/木/暗/其他）：由 LLM 根据歌词主题推断，并附 `element_evidence` 依据；LLM 不可用时回退到关键词规则。
3. **攻速** = BPM 线性映射：`attack_speed = clamp(BPM / 100, 0.5, 2.0)`（BPM 60 → 0.6，BPM 180 → 1.8）。
4. **爆发力** = 副歌段平均响度 / 主歌段平均响度，clamp 到 0~1；无音频降级为 0.5。
5. **蓄力时间** = 前奏长度（LRC 首句歌词时间）；无歌词时取试听片段前 1/4；无音频默认 12s。
6. **技能描述**：LLM 结合曲风/结构/歌词生成中二技能名与描述；失败回退规则模板。
7. **本场战报锐评**：LLM 收到「歌曲/系别/战斗属性/技能/音频分析/排面战况/系别分布/歌词节选」的结构化提示词，输出毒舌但有理有据的锐评（120-250 字）。LLM 不可用/无 Key/异常时回退为规则模板锐评；「再评一次」调用 `/api/analyze/review` 复用 `review_context` 换角度重评，不重新分析、不写缓存。
8. **音频降级**：试听音频不可用或 librosa 失败时，`analysis.audio_analysis=false`，仅用歌词结构 + 规则生成，降级卡片同样参与缓存与排面。

---

## 排面计算口径（重点）

### 缓存
- 存储：SQLite 单文件（默认 `data/cards_cache.db`，环境变量 `CACHE_FILE` 可覆盖）
  - 表 `cards(song_id INTEGER PRIMARY KEY, title, artist, card_json, generated_at)`
  - **`song_id` 唯一约束**：同一首歌重复分析执行 upsert（覆盖旧卡），不产生重复行
  - 旧版 JSONL（`cards_cache.jsonl`）首次启动自动迁移导入，完成后改名 `.imported`
- 上限：**100 份**，超出后按 `generated_at` 升序丢弃最旧（FIFO）
- 并发：单连接 + 线程锁（读-改-写整体加锁），WAL 模式 + 原子事务
- 后端重写可用 `python scripts/seed_cache.py --count 120 --clear` 造数验证

### 百分位定义
```
percentile = (rank - 1) / max(sample_count - 1, 1) * 100
```
- `rank = 1`（第一名）时百分位为 0
- 仅 1 份样本（自己）时，`max(1-1,1)=1`，百分位 = 100
- 之后每生成一份新卡都与「除自身外的缓存样本」比较，先比较后写入，保证自己不与自己做比较

### 单项排名
| 维度 | 越大越靠前？ |
|---|---|
| attack_speed / burst / bpm / chorus_ratio | ✅ |
| cooldown_seconds（冷却越短越好） | ❌ |

返回每条含 `rank`、`percentile`、`best`（当前缓存中该维度最强样本的描述）。

### 综合战力分
```
score = attack_speed * 0.4 + burst * 0.4 + chorus_ratio * 0.2
```
- attack_speed、burst 已归一化到约 0~2 区间，chorus_ratio 为 0~1，因此 score 范围约 0~1.6
- 仅用于相对排名，不对外声称绝对可解释

### 系别分布
`element_distribution` 统计当前缓存（含新卡）中各系别数量。

---

## 项目结构

```
├── index.html          # 前端页面（双 Tab：战斗卡 + 歌单锐评）
├── style.css           # 样式（浅色/深色，战斗卡 + 排面 + 歌单）
├── app.js              # Tab 切换 + 主题
├── battle.js           # 战斗属性卡前端逻辑
├── review.js           # 歌单锐评前端逻辑
├── serve.js            # 本地开发服务器（静态 + API 代理）
├── backend/            # Python FastAPI 后端
│   ├── main.py         # FastAPI 路由
│   ├── pipeline.py     # 分析编排
│   ├── ncm_client.py   # 网易云 API 客户端（代理到容器内 Node）
│   ├── lyric_parser.py # LRC 歌词结构解析（段落/副歌识别）
│   ├── audio_analysis.py # librosa 音频特征（BPM/RMS/响度对比）
│   ├── ranking.py      # 缓存 + 排面计算
│   ├── llm.py          # DeepSeek 语义生成（系别/技能，失败回退规则）
│   ├── requirements.txt
│   └── start.sh        # 容器入口：先启 NCM API 再启 FastAPI
├── scripts/
│   ├── analyze.py      # 命令行 demo
│   ├── seed_cache.py   # 缓存造数（FIFO 验证）
│   └── test_ranking.py # 排面单元测试
├── Dockerfile          # 前端 Nginx 容器
├── Dockerfile.backend  # 后端容器（Node NCM + Python FastAPI）
├── nginx.conf          # 反向代理配置
├── docker-compose.yml  # backend + frontend + cloudflared
└── .env.example        # 环境变量示例
```

---

## 许可证
- 本项目使用 MIT 许可证

## 致谢
- 网易云音乐 API：[Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
- API 备份仓库：[nooblong/NeteaseCloudMusicApiBackup](https://github.com/nooblong/NeteaseCloudMusicApiBackup)