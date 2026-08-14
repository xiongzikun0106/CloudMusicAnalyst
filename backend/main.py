"""FastAPI 主应用 — 战斗 BGM 属性卡 + 歌单品味锐评助手

VPS 部署：一个容器内跑 Node NeteaseCloudMusicApi + Python FastAPI
本应用负责：
  - /api/analyze        战斗 BGM 属性卡生成（含排面）
  - /api/ranking        排行榜查看
  - /api/cache/stats    缓存统计
  - /api/review/*       原有歌单品味锐评功能
  - /proxy/*            NCM API 通用代理（兼容旧前端路径）
"""
import os
import time
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from . import llm
from . import ncm_client
from . import pipeline
from . import ranking

app = FastAPI(title="CloudMusicAnalyst API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://cloudmusicanalyst.net",
        "https://www.cloudmusicanalyst.net",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- 安全加固：限流 + 请求体大小限制 ----------
# 注意：内存限流为单进程方案（uvicorn 单 worker 部署），
# 如需多 worker/多实例请改用 Redis 或网关层限流。

MAX_BODY_BYTES = 1024 * 1024  # 请求体上限 1MB

# 昂贵的 AI / 分析接口：每 IP 每 60 秒最多 5 次
AI_LIMIT_WINDOW = 60
AI_LIMIT_MAX = 5
# 普通接口：每 IP 每 60 秒最多 120 次
GENERAL_LIMIT_WINDOW = 60
GENERAL_LIMIT_MAX = 120

_AI_LIMIT_PATHS = {"/api/analyze", "/api/analyze/review", "/api/review/ai_review"}
_ai_hits: dict = defaultdict(list)
_general_hits: dict = defaultdict(list)


def _client_ip(request: Request) -> str:
    # nginx 已设置 X-Forwarded-For（真实客户端 IP）
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 请求体大小限制
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "请求体过大"}, status_code=413)

        # 限流
        ip = _client_ip(request)
        now = time.time()
        if request.url.path in _AI_LIMIT_PATHS:
            bucket = _ai_hits[ip]
            window, limit = AI_LIMIT_WINDOW, AI_LIMIT_MAX
        else:
            bucket = _general_hits[ip]
            window, limit = GENERAL_LIMIT_WINDOW, GENERAL_LIMIT_MAX
        bucket[:] = [t for t in bucket if now - t < window]
        if len(bucket) >= limit:
            return JSONResponse({"detail": "请求过于频繁，请稍后再试"}, status_code=429)
        bucket.append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)

# ---------- 请求模型 ----------

class AnalyzeRequest(BaseModel):
    text: str = Field(..., max_length=500)


class SearchRequest(BaseModel):
    keywords: str = Field(..., max_length=100)



class SearchUsersRequest(BaseModel):
    nickname: str = Field(..., max_length=100)


class UserPlaylistsRequest(BaseModel):
    uid: str = Field(..., max_length=50)


class PlaylistTracksRequest(BaseModel):
    playlist_id: str = Field(..., max_length=50)


class ReviewRequest(BaseModel):
    uid: str = Field(default="", max_length=50)
    playlist_id: str = Field(default="", max_length=50)
    text: str = Field(default="", max_length=200000)  # 完整提示词文本（全员锐评可能较大）


# ---------- 战斗 BGM 属性卡 ----------

class ReviewContextRequest(BaseModel):
    review_context: dict = None


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    """分析一首歌，生成战斗 BGM 属性卡 + 排面。"""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="请输入歌名、网易云链接或歌曲 ID")
    try:
        result = pipeline.analyze_song_text(text)
        return result
    except pipeline.AnalyzeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=f"网易云接口不可用：{e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败：{e}")


@app.post("/api/search")
def search_songs_api(req: SearchRequest):
    """按关键词搜索歌曲，返回候选列表（供前端确认版本，避免解析到同名/翻唱）。"""
    keywords = req.keywords.strip()
    if not keywords:
        raise HTTPException(status_code=400, detail="请输入关键词")
    try:
        candidates = ncm_client.search_song_candidates(keywords, limit=10)
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=f"网易云接口不可用：{e}")
    return {"candidates": candidates}


@app.post("/api/analyze/review")
def reanalyze_review(req: ReviewContextRequest):
    """重新生成属性卡锐评（不重新分析、不写缓存）。"""
    if not req.review_context:
        raise HTTPException(status_code=400, detail="缺少 review_context")
    try:
        review = llm.generate_battle_review_from_context(req.review_context)
        return {"review": review}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"锐评生成失败：{e}")


@app.get("/api/ranking")
def get_ranking(dimension: str = Query("overall", description="维度：overall/attack_speed/burst/bpm/chorus_ratio/cooldown_seconds")):
    """查看当前缓存在某维度下的排行榜 TOP N（默认取前 20）。"""
    cards = ranking.load_cards()
    if not cards:
        return {"sample_count": 0, "items": []}

    dim_defs = ranking.DIM_DEFS
    if dimension == "overall":
        items = sorted(cards, key=lambda c: ranking._overall_score(c), reverse=True)
        items = [
            {
                "title": (c.get("song") or {}).get("title", ""),
                "artist": (c.get("song") or {}).get("artist", ""),
                "value": round(ranking._overall_score(c), 4),
                "element": (c.get("battle_card") or {}).get("element", ""),
            }
            for c in items
        ]
    elif dimension in dim_defs:
        field, higher = dim_defs[dimension]
        items = [c for c in cards if ranking._deep_get(c, field) is not None]
        items.sort(key=lambda c: ranking._deep_get(c, field), reverse=higher)
        items = [
            {
                "title": (c.get("song") or {}).get("title", ""),
                "artist": (c.get("song") or {}).get("artist", ""),
                "value": ranking._deep_get(c, field),
                "element": (c.get("battle_card") or {}).get("element", ""),
            }
            for c in items
        ]
    else:
        raise HTTPException(status_code=400, detail=f"未知维度：{dimension}")

    return {"sample_count": len(cards), "dimension": dimension, "items": items[:20]}


@app.get("/api/cache/stats")
def cache_stats():
    """缓存数量、系别分布等统计。"""
    cards = ranking.load_cards()
    elem_dist = {}
    for c in cards:
        elem = (c.get("battle_card") or {}).get("element") or "其他"
        elem_dist[elem] = elem_dist.get(elem, 0) + 1
    return {
        "sample_count": len(cards),
        "max_capacity": ranking.MAX_CACHE,
        "element_distribution": elem_dist,
        "audio_analysis_count": sum(1 for c in cards if (c.get("analysis") or {}).get("audio_analysis", True)),
        "degraded_count": sum(1 for c in cards if not (c.get("analysis") or {}).get("audio_analysis", True)),
    }


# ---------- 原有：歌单品味锐评 ----------

@app.post("/api/review/search_users")
def review_search_users(req: SearchUsersRequest):
    """昵称搜索用户，返回 [{nickname, uid}]。"""
    nickname = req.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="请输入用户昵称")
    try:
        nicknames = ncm_client.get_userids(nickname)
        items = [{"nickname": n, "uid": str(u)} for n, u in nicknames.items()]
        items = [it for it in items if nickname.lower() in it["nickname"].lower()]
        return {"code": 200, "users": items}
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/review/user_playlists")
def review_user_playlists(req: UserPlaylistsRequest):
    """获取用户歌单列表。"""
    if not req.uid.strip():
        raise HTTPException(status_code=400, detail="缺少 uid 参数")
    try:
        playlists = ncm_client.user_playlist(req.uid)
        # 只保留用户自己创建的歌单
        own = [p for p in playlists if str(p.get("userId")) == str(req.uid)]
        return {
            "code": 200,
            "playlists": [
                {
                    "id": p.get("id"),
                    "name": p.get("name") or "未命名",
                    "trackCount": p.get("trackCount", 0),
                    "coverImgUrl": p.get("coverImgUrl", ""),
                    "creator": (p.get("creator") or {}).get("nickname", ""),
                    "avatarUrl": (p.get("creator") or {}).get("avatarUrl", ""),
                }
                for p in (own if own else playlists)
            ],
        }
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/review/playlist_tracks")
def review_playlist_tracks(req: PlaylistTracksRequest):
    """获取歌单全部歌曲。"""
    if not req.playlist_id.strip():
        raise HTTPException(status_code=400, detail="缺少 playlist_id 参数")
    try:
        songs = ncm_client.playlist_tracks(req.playlist_id)
        return {
            "code": 200,
            "songs": [
                {
                    "id": s.get("id"),
                    "name": s.get("name") or "未知",
                    "artist": "/".join(a.get("name", "") for a in (s.get("ar") or [])) or "未知",
                }
                for s in songs
            ],
        }
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/review/generate_prompt")
def review_generate_prompt(req: ReviewRequest):
    """生成提示词。
    - 提供 playlist_id：单歌单提示词（JSON 数组）
    - 仅 uid：全员锐评提示词（歌单列表）
    """
    if not req.playlist_id and not req.uid:
        raise HTTPException(status_code=400, detail="需要提供 playlist_id 或 uid")
    try:
        if req.playlist_id:
            songs = ncm_client.playlist_tracks(req.playlist_id)
            if not songs:
                raise HTTPException(status_code=400, detail="该歌单无有效歌曲")
            prompt = "【请锐评以下歌单的品味】\n歌单名称：未知\n歌曲数量：%d\n数据格式：JSON 数组 [{name:\"歌曲名\", artist:\"歌手\"}, ...]\n\n请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价：\n\n" % len(songs)
            songs_json = [
                {"name": s.get("name") or "未知",
                 "artist": "/".join(a.get("name", "") for a in (s.get("ar") or [])) or "未知"}
                for s in songs
            ]
            prompt += str(songs_json)
            return {"code": 200, "prompt": prompt, "songCount": len(songs), "mode": "playlist", "playlistName": "未命名"}
        elif req.uid:
            playlists = ncm_client.user_playlist(req.uid)
            own = [p for p in playlists if str(p.get("userId")) == str(req.uid)] or playlists
            pl_info = [{"name": p.get("name"), "trackCount": p.get("trackCount", 0)} for p in own]
            prompt = (
                "【请锐评以下音乐品味】\n数据格式：JSON 对象 {playlists:[{name,trackCount},...]}\n\n"
                + str({"playlists": pl_info})
                + "\n\n---\n请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价。"
            )
            return {"code": 200, "prompt": prompt, "playlistCount": len(own), "mode": "full"}
    except ncm_client.NcmError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/review/ai_review")
def review_ai_review(req: ReviewRequest):
    """把提示词发送给 DeepSeek 生成毒舌锐评。"""
    import httpx
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY 未配置")
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空")
    try:
        resp = httpx.post(
            os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com/v1/chat/completions"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
                "messages": [
                    {"role": "system", "content": "你是一个音乐品味锐评人。用户给你 JSON 格式的歌单数据，请从音乐品味、风格偏好、年代分布等角度输出 200-500 字中文评价，毒舌幽默但不失礼貌。"},
                    {"role": "user", "content": req.text},
                ],
                "max_tokens": 1024,
                "temperature": 0.8,
                "stream": False,
            },
            timeout=90,
        )
        resp.raise_for_status()
        data = resp.json()
        reply = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return {"code": 200, "reply": reply}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 锐评失败：{e}")


# ---------- 原有：NCM API 通用代理 ----------

# 兼容旧路径（原前端调用的 /user/playlist 等直接代理）
_NCM_PROXY_PATHS = {"/user/playlist", "/playlist/track/all", "/get/userids", "/search", "/lyric", "/song/detail", "/song/url"}

from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse


@app.api_route("/{path:path}", methods=["GET", "POST", "OPTIONS"], include_in_schema=False)
async def legacy_proxy(path: str, request: StarletteRequest):
    """兼容旧前端：/user/playlist、/playlist/track/all、/get/userids、/search 等直接代理到 NCM"""
    full_path = "/" + path if not path.startswith("/") else path
    if full_path in _NCM_PROXY_PATHS:
        try:
            query = str(request.url.query)
            body = await request.body() if request.method.upper() == "POST" else None
            if request.method.upper() == "OPTIONS":
                return JSONResponse(content={}, status_code=200)
            status, data = ncm_client.api_proxy(request.method, full_path, query, body)
            return JSONResponse(content=data, status_code=status)
        except ncm_client.NcmError as e:
            return JSONResponse(content={"code": 500, "msg": str(e)}, status_code=502)
    return JSONResponse(content={"code": 404, "msg": "Not Found"}, status_code=404)
