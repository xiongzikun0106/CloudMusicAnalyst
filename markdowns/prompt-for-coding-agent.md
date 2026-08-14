# 任务：实现「战斗 BGM 属性卡生成器」Web 应用

## 项目背景

一个趣味脑洞产品：假设每个人在音乐品味定型期（约 15-25 岁）选一首歌作为自己人生/战斗时的 BGM。这首歌将变成一张「战斗 BGM 属性卡」，拥有冷却时间、战斗属性加成与技能描述。本任务实现一个 Web 应用：用户输入网易云音乐的歌名/链接，系统自动分析该歌曲，生成一张完整的战斗 BGM 属性卡，并与最近 100 份历史卡片比较，输出"排面"（排名/百分位）。

## 核心设定（产品规则，必须遵守）

1. 冷却时间 = 歌曲完整时长。**时长小于 1 分钟的歌不允许参战**（校验并拒绝）。
2. 根据歌曲的**曲风 / 结构 / 歌词**计算战斗属性加成，至少包含：
   - **系别**（元素属性）：由歌词主题推断。示例：燃烧/呐喊→火；大海/星空→水；流浪/远方→风；钢铁/机械→雷；自然/森林→木；黑暗/夜晚→暗 等。系别必须能从歌词中给出依据。
   - **攻速**：由 BPM 线性映射（如 BPM 60→0.6，BPM 180→1.8）。
   - **爆发力**：由副歌/高潮段响度相对主歌的提升幅度决定。
   - **蓄力时间**：由前奏长度/进入副歌的时间决定。
   - **冷却**：即歌曲完整时长，格式化输出。
   - **技能描述**：结合曲风、结构（如副歌占比高→循环爆发型）、歌词主题生成一段中二但合理的技能文字。
3. 输出为结构化 JSON（schema 见下），包含 `battle_card` 与新增的 `ranking` 排面字段。

## 技术方案

### 架构

```
┌─ 数据层：自建 NeteaseCloudMusicApi（开源 Node 项目）
│    歌曲信息 / LRC 歌词(带时间戳) / 试听音频(30-60s)
├─ 特征层：Python + librosa + 歌词结构解析
│    BPM / RMS 能量包络 / 段落结构 / 曲风标签
├─ 属性层：LLM 根据特征 JSON + 歌词生成属性面板
├─ 排面层：缓存最近 100 份卡片，计算排名/百分位
└─ 展示层：Web 前端（输入歌名 → 战斗卡 + 排面榜，含能量波形图）
```

### 关键实现要点

**1. 数据获取**
- 自建开源项目 `Binaryify/NeteaseCloudMusicApi`（Node.js，跑在 3000 端口）：
  - `GET /search?keywords=<歌名>` → 取 song id
  - `GET /lyric?id=<song_id>` → LRC 歌词（带时间戳）
  - `GET /song/url?id=<song_id>` → 试听音频直链（30-60 秒，够用）
  - `GET /song/detail?ids=<song_id>` → 歌曲信息（时长、曲风标签）
- **注意：只用试听片段做音频分析，不需要全曲**。试听片段足够提取 BPM 和响度包络；结构分析以 LRC 时间戳为主力。

**2. 歌词结构解析**（纯文本处理）
- 按时间戳切分歌词行，聚合成段落。
- 重复出现的段落（相似文本）识别为副歌（Chorus）。
- 统计：段落数、副歌次数、副歌占比、首句歌词时间（前奏长度）、副歌首次出现时间。
- 歌词全文保留，供 LLM 做主题/系别推断。

**3. 音频特征提取**（librosa）
```python
import librosa
y, sr = librosa.load('preview.mp3')
bpm = librosa.beat.beat_track(y=y, sr=sr)          # 攻速
rms = librosa.feature.rms(y=y)[0]                  # 响度曲线
# 按 LRC 时间戳把 rms 对齐到每个歌词段 → 每段平均响度
# 计算：副歌平均响度 vs 主歌平均响度 → 爆发力
# 前奏（首句歌词前）平均响度 → 蓄力判断
```
- librosa 是 Python 音频分析库，用于提取 BPM、RMS 能量包络等特征，无需人工 DSP 知识。

**4. LLM 属性生成**
- 将「BPM、时长、曲风标签、段落结构（含副歌占比/前奏长度）、能量对比、歌词全文」打包为 JSON 特征文件。
- 调用 LLM（OpenAI 兼容接口或本地 Ollama 均可）生成属性卡，要求输出严格符合 JSON schema。
- LLM 输出后做字段校验，缺失/非法字段回退到规则默认值（BPM 映射、响度对比等由代码兜底，不依赖 LLM）。

**5. 缓存与排面对比（本任务新增重点功能）**
- 存储：`data/cards_cache.jsonl`（每行一份完整属性卡 JSON，追加写入），或 SQLite 均可，自行选择并说明理由。缓存上限 **100 份**，超出后丢弃最旧（FIFO）。
- 每份缓存记录必须含：`generated_at`（ISO 时间戳）、song id、title、`battle_card` 的全部数值字段（attack_speed、burst、charge_time_seconds、cooldown_seconds）、`analysis.bpm`、`analysis.chorus_ratio`、`analysis.intro_seconds`。
- 新卡片生成后，与当前缓存中所有卡片比较，计算：
  - **单项排名**：攻速、爆发力、BPM、副歌占比 各自在缓存中的名次（值越大越靠前；蓄力时间越短排名越高）。
  - **百分位**：`percentile = (排名-1) / max(样本数-1, 1) * 100` 或等价定义，在文档中说明口径。
  - **综合战力分**：`attack_speed * 0.4 + burst * 0.4 + (副歌占比) * 0.2` 的归一化公式（可自行微调，但必须在代码与文档中写清公式），同样给出排名与百分位。
  - **系别分布**：当前缓存中各系别的数量统计（如"火系已有 23 人"）。
- 输出到属性卡 JSON 的 `ranking` 字段（schema 见下）。
- 比较完成后再把新卡片写入缓存（保证自己不与自己做比较）。
- 若缓存为空（第一份卡片），`ranking` 字段输出样本数为 1、百分位 100%、排名 1/1，并在 `ranking.note` 注明"暂无足够样本"。

**6. Web 应用**
- 后端：Python FastAPI，接口：
  - `POST /api/analyze`（入参：歌名或网易云链接；出参：属性卡 JSON + 波形数据 + ranking）
  - `GET /api/ranking?dimension=burst`（可选：查看当前缓存在该维度下的排行榜 TOP N）
  - `GET /api/cache/stats`（可选：缓存数量、系别分布等统计）
- 前端：单页，输入框 + 结果卡片展示。卡片包含：歌名/歌手、系别图标、六维属性条、能量波形图（用试听片段的 RMS 数据绘制，SVG 或 Canvas）、技能描述、冷却倒计时 UI（可选）、**排面区块**（各维度排名/百分位条 + 系别人数）。
- 支持直接贴网易云歌曲链接解析出 song id。

## 输出 JSON Schema（属性卡，含 ranking）

```json
{
  "song": {
    "id": 123456,
    "title": "歌名",
    "artist": "歌手",
    "album": "专辑",
    "genre_tags": ["流行", "摇滚"],
    "duration_seconds": 273,
    "duration_text": "4分33秒",
    "lyric_url": "https://...",
    "preview_url": "https://..."
  },
  "analysis": {
    "bpm": 128.0,
    "section_count": 8,
    "chorus_count": 3,
    "chorus_ratio": 0.38,
    "intro_seconds": 12.5,
    "first_chorus_seconds": 48.0,
    "chorus_loudness_ratio": 1.35,
    "structure_type": "循环爆发型",
    "audio_analysis": true
  },
  "battle_card": {
    "element": "火",
    "element_evidence": "歌词反复出现'燃烧''呐喊'等意象",
    "attack_speed": 1.28,
    "burst": 0.82,
    "charge_time_seconds": 12.5,
    "cooldown_text": "4分33秒",
    "cooldown_seconds": 273,
    "skill_name": "烈焰副歌·循环爆发",
    "skill_description": "副歌响起时攻速+20%，爆发力拉满，持续至副歌结束；冷却4分33秒。"
  },
  "ranking": {
    "sample_count": 100,
    "dimensions": {
      "attack_speed": { "rank": 12, "percentile": 88.9, "best": "《另一首歌》1.85" },
      "burst": { "rank": 3, "percentile": 98.0, "best": "《某神曲》0.95" },
      "bpm": { "rank": 34, "percentile": 66.7, "best": "《极速》190" },
      "chorus_ratio": { "rank": 21, "percentile": 79.8, "best": "《副歌循环机》0.55" },
      "cooldown_seconds": { "rank": 45, "percentile": 55.6, "best": "《最短》61" }
    },
    "overall": { "score": 0.87, "rank": 8, "percentile": 92.9 },
    "element_distribution": { "火": 23, "水": 18, "风": 15, "雷": 12, "木": 9, "暗": 8, "其他": 15 },
    "note": ""
  }
}
```

## 验收标准

1. 输入 3 首不同的歌（覆盖：快歌/慢歌、中文/英文、有标签/无标签），都能生成合法完整的属性卡 JSON，且含有效 `ranking` 字段。
2. 时长 < 1 分钟的歌被正确拒绝并返回明确错误信息。
3. 缓存功能：连续生成 3 份卡片后，`sample_count` 依次为 1、2、3；手动往缓存注入 100+ 份（可用测试脚本造数），验证 FIFO 裁剪后缓存恰好 100 份。
4. 排面正确性：手工构造 2 份已知数值的卡片，验证排名/百分位计算与手算一致（单元测试覆盖）。
5. `bpm`、`chorus_ratio`、`intro_seconds` 等数值与代码分析结果一致（可复现）。
6. 前端页面能展示属性卡、排面区块与能量波形图，离线资源可正常加载。
7. 全流程命令行可跑通：`python analyze.py "歌名"` 输出 JSON；Web 端同样可跑通。

## 工程约束

- 代码仓库结构清晰：`api/`（网易云 API 服务）、`backend/`（FastAPI + 分析 + 排面）、`frontend/`（静态页面）、`scripts/`（命令行 demo 与测试造数脚本）、`data/`（缓存文件，gitignore）。
- README 写清启动步骤（含 NeteaseCloudMusicApi 的 clone/install/run）与排面计算口径（公式、百分位定义）。
- 依赖最小化，librosa 等重依赖只装在 backend。
- 网易云接口若遇风控/失效，给出明确错误提示，不要静默失败。
- 缓存读写需加锁或原子写，避免并发请求时损坏。
- 先跑通命令行 demo（scripts/analyze.py "歌名"），再做 Web 层。

## 备注

- 趣味产品，属性为娱乐性生成，不追求音乐学严谨性，但数值要有可复现的计算逻辑（BPM 映射、响度对比、占比计算、排面公式都是确定性代码逻辑，LLM 只负责系别/技能描述的语义生成）。
- 若试听音频不可用，允许降级：仅用歌词结构 + 曲风标签生成属性卡，并在 `analysis` 中标注 `"audio_analysis": false`；降级卡片同样参与缓存与排面（在 `ranking.note` 中标注"含 N 份无音频样本"）。
