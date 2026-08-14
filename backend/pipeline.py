"""分析编排 — 数据获取 → 特征分析 → LLM → 属性卡组装 → 排面计算"""
import datetime as dt

from . import ncm_client
from . import lyric_parser
from . import llm as llm_mod
from . import ranking
from .audio_analysis import analyze_preview, download_audio, has_librosa

MIN_DURATION_SECONDS = 60  # 时长 < 60s 不允许参战


class AnalyzeError(Exception):
    pass


def _format_duration(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(round(seconds % 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}分{s:02d}秒"


def _normalize_burst(value) -> float:
    """爆发力 0~1 归一化。

    映射：burst = clamp(响度比 / 2.0, 0.4, 1.0)
      - 副歌与主歌等响（ratio=1.0）→ 0.5（平均水平）
      - 响度比 1.4 → 0.7，1.8 → 0.9，>= 2.0 → 1.0
    value 为空/异常/<=0 时回退 0.5。
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.5
    if v <= 0:
        return 0.5
    return round(max(0.4, min(1.0, v / 2.0)), 3)


def _attack_speed_from_bpm(bpm) -> float:
    """攻速 = BPM 线性映射：BPM 60→0.6，BPM 180→1.8（clamp 0.5~2.0）"""
    try:
        b = float(bpm)
    except (TypeError, ValueError):
        b = 0.0
    if b <= 0:
        return 0.6
    return max(0.5, min(2.0, b / 100.0))


def _validate_duration(duration_seconds) -> float:
    try:
        d = float(duration_seconds)
    except (TypeError, ValueError):
        d = 0.0
    if d < MIN_DURATION_SECONDS:
        raise AnalyzeError(
            f"该歌曲时长 {_format_duration(d)} 不足 1 分钟，不允许参战！（规则：冷却时间 = 歌曲完整时长，<1 分钟的歌无法参战）"
        )
    return d


def _inject_lyric_intervals(lyr: lyric_parser.LyricAnalysis):
    """把段落切分结果转成 chorus/verse 时间区间，注入 LyricAnalysis。

    供 audio_analysis 计算副歌/主歌响度对比时使用。
    """
    chorus = []
    verse = []
    for sec in (lyr.sections or []):
        start = sec.start_time
        end = sec.end_time
        if end <= start:
            end = start + 1.0
        if sec.is_chorus:
            chorus.append((start, end))
        else:
            verse.append((start, end))
    lyr.chorus_intervals = chorus
    lyr.verse_intervals = verse


def analyze_song_text(text: str) -> dict:
    """完整分析入口：输入歌名/链接/ID → 属性卡 JSON（含 ranking 与 waveform）。

    返回 schema 与 markdowns/prompt-for-coding-agent.md 一致。
    """
    # 1. 数据获取
    resolved = ncm_client.resolve_input(text)
    song_id = resolved["song_id"]
    title = resolved["title"]
    artist = resolved["artist"]

    detail = ncm_client.song_detail(song_id)
    duration_seconds = _validate_duration(float(detail.get("dt", 0) / 1000.0))

    album = ""
    al = detail.get("al") or {}
    album = al.get("name") or ""

    genre_tags = []
    # 网易云 search/detail 无稳定曲风字段，保留空数组（由 LLM 语义推断）

    lrc_text = ncm_client.lyric(song_id)
    preview_url = ncm_client.song_url(song_id)

    # 2. 歌词结构
    lyr = lyric_parser.analyze_lyric(lrc_text)
    _inject_lyric_intervals(lyr)

    # 3. 音频分析（可降级）
    audio_ok = False
    bpm = None
    waveform = []
    chorus_loudness_ratio = None
    intro_rms = None
    if preview_url and has_librosa():
        try:
            audio_bytes = download_audio(preview_url)
            audio = analyze_preview(audio_bytes, lyric_analysis=lyr)
            bpm = audio.get("bpm")
            waveform = audio.get("waveform", [])
            chorus_loudness_ratio = audio.get("chorus_loudness_ratio")
            intro_rms = audio.get("intro_rms")
            audio_ok = True
        except Exception:
            # 降级：仅歌词 + 规则分析
            audio_ok = False
            bpm = None
            waveform = []
            chorus_loudness_ratio = None
            intro_rms = None
    else:
        audio_ok = False

    # 4. 确定性数值计算
    chorus_ratio = lyr.chorus_ratio if lyr.has_lyric else 0.0
    intro_seconds = lyr.intro_seconds if lyr.has_lyric else 0.0
    first_chorus_seconds = lyr.first_chorus_seconds if lyr.has_lyric else 0.0
    section_count = lyr.section_count if lyr.has_lyric else 0
    chorus_count = lyr.chorus_count if lyr.has_lyric else 0

    attack_speed = _attack_speed_from_bpm(bpm) if (audio_ok and bpm) else 0.6
    burst = _normalize_burst(chorus_loudness_ratio) if audio_ok else 0.5

    # 蓄力时间：前奏长度 > 0 用前奏；无歌词但有音频用片段前 1/4；都无则默认 12s
    if lyr.has_lyric and intro_seconds > 0:
        charge_time = intro_seconds
    elif audio_ok and waveform:
        charge_time = round(audio.get("duration_seconds", 30.0) * 0.25, 1)
    else:
        charge_time = 12.0

    cooldown_seconds = int(round(duration_seconds))
    cooldown_text = _format_duration(duration_seconds)
    structure_type = lyr.structure_type if lyr.has_lyric else "未知"

    # 5. LLM 语义生成（系别/技能描述，失败回退规则）
    features = {
        "title": title,
        "artist": artist,
        "bpm": bpm,
        "duration_seconds": duration_seconds,
        "genre_tags": genre_tags,
        "structure_type": structure_type,
        "section_count": section_count,
        "chorus_count": chorus_count,
        "chorus_ratio": chorus_ratio,
        "intro_seconds": intro_seconds,
        "first_chorus_seconds": first_chorus_seconds,
        "chorus_loudness_ratio": chorus_loudness_ratio,
        "attack_speed": attack_speed,
        "burst": burst,
        "charge_time_seconds": charge_time,
        "cooldown_text": cooldown_text,
    }
    semantic = llm_mod.generate_battle_semantics(features, lyr.full_text)

    # 6. 组装属性卡
    song_part = {
        "id": int(song_id),
        "title": title,
        "artist": artist,
        "album": album,
        "genre_tags": genre_tags,
        "duration_seconds": int(round(duration_seconds)),
        "duration_text": cooldown_text,
        "lyric_url": f"https://music.163.com/song?id={song_id}",
        "preview_url": preview_url,
    }
    analysis_part = {
        "bpm": bpm if audio_ok else None,
        "section_count": section_count,
        "chorus_count": chorus_count,
        "chorus_ratio": round(chorus_ratio, 4),
        "intro_seconds": round(intro_seconds, 2),
        "first_chorus_seconds": round(first_chorus_seconds, 2) if first_chorus_seconds else None,
        "chorus_loudness_ratio": chorus_loudness_ratio,
        "structure_type": structure_type,
        "audio_analysis": audio_ok,
    }
    battle_card_part = {
        "element": semantic["element"],
        "element_evidence": semantic["element_evidence"],
        "attack_speed": round(attack_speed, 2),
        "burst": burst,
        "charge_time_seconds": round(charge_time, 1),
        "cooldown_text": cooldown_text,
        "cooldown_seconds": cooldown_seconds,
        "skill_name": semantic["skill_name"],
        "skill_description": semantic["skill_description"],
    }

    new_card = {
        "song": song_part,
        "analysis": analysis_part,
        "battle_card": battle_card_part,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

    # 7. 排面计算（先比较后写入，保证自己不与自己做比较）
    existing = ranking.load_cards()
    rank_info = ranking.compute_ranking(new_card, existing)
    new_card["ranking"] = rank_info
    ranking.append_card(new_card)

    # 8. LLM 锐评（基于属性/歌词/排面；失败回退规则模板）
    review_features = {
        **features,
        "element": semantic["element"],
        "element_evidence": semantic["element_evidence"],
        "skill_name": semantic["skill_name"],
        "skill_description": semantic["skill_description"],
        "audio_analysis": audio_ok,
    }
    review_text = llm_mod.generate_battle_review(review_features, rank_info, lyr.full_text)

    # 9. 返回（waveform 与 review_context 仅随响应返回，不写入缓存）
    return {
        **new_card,
        "analysis": {
            **analysis_part,
            "waveform": waveform if audio_ok else [],
        },
        "review": review_text,
        "review_context": {
            "features": review_features,
            "ranking": rank_info,
            "lyric_snippet": lyr.full_text[:1500],
        },
    }
