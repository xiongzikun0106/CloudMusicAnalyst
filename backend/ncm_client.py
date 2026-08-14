"""网易云音乐 API 客户端 — 代理到容器内 Node NeteaseCloudMusicApi（端口 3000）"""
import os
import urllib.parse
import httpx

NCM_BASE = os.environ.get("NCM_API_BASE", "http://127.0.0.1:3000")
TIMEOUT = 20.0


class NcmError(Exception):
    pass


def _form_url(path: str, params: dict = None) -> str:
    url = f"{NCM_BASE}{path}"
    if params:
        qs = urllib.parse.urlencode(params)
        url = f"{url}?{qs}"
    return url


def _post(path, params=None, data=None) -> dict:
    url = _form_url(path, params)
    try:
        resp = httpx.post(url, data=data or {}, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        raise NcmError(f"网易云 API 请求失败（{path}）: {e}") from e


def _get(path, params=None) -> dict:
    url = _form_url(path, params)
    try:
        resp = httpx.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        raise NcmError(f"网易云 API 请求失败（{path}）: {e}") from e


def _check_code(data: dict, ok_codes=(200,)) -> dict:
    code = data.get("code")
    if code not in ok_codes:
        raise NcmError(f"网易云 API 错误: {data.get('msg') or data.get('message') or f'code={code}'}")
    return data


# ---------- 字段解析辅助（兼容搜索/详情两种 schema） ----------

def _artists_str(song: dict) -> str:
    """取歌手名。搜索接口字段为 artists，详情接口字段为 ar。"""
    for key in ("ar", "artists"):
        arr = song.get(key) or []
        names = [a.get("name", "") for a in arr if a.get("name")]
        if names:
            return "/".join(names)
    return "未知"


def _album_name(song: dict) -> str:
    """取专辑名。搜索接口字段为 album，详情接口字段为 al。"""
    al = song.get("al") or song.get("album") or {}
    return al.get("name") or ""


def _duration_seconds(song: dict) -> int:
    """取时长（毫秒→秒）。搜索接口字段为 duration，详情接口字段为 dt。"""
    d = song.get("dt") if song.get("dt") is not None else song.get("duration")
    try:
        return max(0, int(float(d) / 1000))
    except (TypeError, ValueError):
        return 0


# ---------- 歌曲搜索 ----------

def search_song(keywords: str) -> dict:
    """搜索歌曲，返回第一条匹配的歌曲信息（song detail 结构）"""
    # 注意：POST form 在此 NCM API fork 下关键词不生效，必须用 GET query
    data = _get("/search", {"keywords": keywords, "limit": 5, "type": 1})
    data = _check_code(data)
    songs = (data.get("result") or {}).get("songs") or []
    if not songs:
        raise NcmError(f"未搜索到歌曲「{keywords}」")
    return songs[0]


def search_songs(keywords: str, limit: int = 10) -> list:
    data = _get("/search", {"keywords": keywords, "limit": limit, "type": 1})
    data = _check_code(data)
    return (data.get("result") or {}).get("songs") or []


def search_song_candidates(keywords: str, limit: int = 10) -> list:
    """搜索歌曲，返回候选列表（供前端让用户确认具体版本）。

    返回 [{id, name, artist, album, duration_seconds}, ...]
    """
    data = _get("/search", {"keywords": keywords, "limit": limit, "type": 1})
    data = _check_code(data)
    songs = (data.get("result") or {}).get("songs") or []
    out = []
    for s in songs:
        out.append({
            "id": int(s.get("id") or 0),
            "name": s.get("name") or "未知",
            "artist": _artists_str(s),
            "album": _album_name(s),
            "duration_seconds": _duration_seconds(s),
        })
    return out



# ---------- 歌曲信息 ----------

def song_detail(song_id: int) -> dict:
    data = _get("/song/detail", {"ids": song_id})
    data = _check_code(data)
    songs = data.get("songs") or []
    if not songs:
        raise NcmError(f"未找到歌曲 id={song_id}")
    return songs[0]


def lyric(song_id: int) -> str:
    """返回 LRC 歌词纯文本（无时间戳版本返回空字符串）"""
    data = _get("/lyric", {"id": song_id})
    data = _check_code(data)
    lrc = data.get("lrc") or {}
    return lrc.get("lyric") or ""


def song_url(song_id: int) -> str:
    """获取试听音频直链（30-60s）。失败返回空字符串。"""
    data = _get("/song/url", {"id": song_id, "br": 128000})
    data = _check_code(data)
    urls = data.get("data") or []
    if urls:
        return urls[0].get("url") or ""
    return ""


# ---------- 歌单 / 用户（原有歌单锐评功能） ----------

def user_playlist(uid, limit=100) -> list:
    data = _post("/user/playlist", data={"uid": uid, "limit": limit})
    data = _check_code(data)
    return data.get("playlist") or []


def playlist_tracks(playlist_id, limit=1000) -> list:
    data = _post("/playlist/track/all", data={"id": playlist_id, "limit": limit})
    data = _check_code(data)
    return data.get("songs") or []


def get_userids(nicknames: str) -> dict:
    """昵称 → {昵称: uid} 映射"""
    data = _post("/get/userids", data={"nicknames": nicknames})
    data = _check_code(data)
    return data.get("nicknames") or {}


def api_proxy(method: str, path: str, query: str, body: bytes = None) -> tuple:
    """通用代理（供 FastAPI 转发原 NCM 路径）"""
    url = f"{NCM_BASE}{path}"
    if query:
        url = f"{url}?{query}"
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        if method.upper() == "POST":
            resp = httpx.post(url, content=body, headers=headers, timeout=TIMEOUT)
        else:
            resp = httpx.get(url, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.status_code, resp.json()
    except httpx.HTTPError as e:
        raise NcmError(f"网易云 API 转发失败（{path}）: {e}") from e


# ---------- 链接解析 ----------

def resolve_input(text: str) -> dict:
    """解析输入：返回 {song_id, title, artist} 或抛出 NcmError。
    支持：纯数字 ID、网易云歌曲链接（music.163.com / 163cn.tv）
    """
    text = text.strip()
    if not text:
        raise NcmError("输入不能为空")

    song_id = parse_ncm_link(text)
    if song_id is not None:
        detail = song_detail(song_id)
        return {
            "song_id": int(detail["id"]),
            "title": detail.get("name") or "未知",
            "artist": _artists_str(detail),
        }

    # 纯数字视为 song id
    if text.isdigit():
        detail = song_detail(int(text))
        return {
            "song_id": int(detail["id"]),
            "title": detail.get("name") or "未知",
            "artist": _artists_str(detail),
        }

    # 歌名搜索
    song = search_song(text)
    return {
        "song_id": int(song["id"]),
        "title": song.get("name") or "未知",
        "artist": _artists_str(song),
    }


_ALLOWED_NCM_HOSTS = ("music.163.com", "163cn.tv", "www.163.com", "m.music.163.com")


def _host_allowed(host: str) -> bool:
    """仅允许网易云官方域名（防 SSRF：拒绝跳转到内网/云元数据地址）。"""
    h = (host or "").lower().rstrip(".")
    if not h:
        return False
    return any(h == x or h.endswith("." + x) for x in _ALLOWED_NCM_HOSTS)


def parse_ncm_link(text: str):
    """从网易云链接提取 song id。支持：
    - https://music.163.com/#/song?id=xxx
    - https://music.163.com/song?id=xxx
    - https://music.163.com/song/media/outer/url?id=xxx
    - https://163cn.tv/xxxxx（短链，需跟随跳转，仅允许跳转到网易云官方域名）
    """
    s = text.lower()
    if "163cn.tv" in s or "music.163.com" in s:
        # 尝试直接解析 ?id=
        if "song" in s and "id=" in s:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(text).query)
            if "id" in qs:
                try:
                    return int(qs["id"][0])
                except ValueError:
                    return None
        # 短链：跟随跳转（仅信任网易云官方域名，防 SSRF）
        if "163cn.tv" in s:
            try:
                resp = httpx.get(text, follow_redirects=True, timeout=15)
                if not _host_allowed(resp.url.host or ""):
                    return None
                final = str(resp.url)
                if "id=" in final:
                    qs = urllib.parse.parse_qs(urllib.parse.urlparse(final).query)
                    if "id" in qs:
                        try:
                            return int(qs["id"][0])
                        except ValueError:
                            return None
            except httpx.HTTPError:
                return None
    return None