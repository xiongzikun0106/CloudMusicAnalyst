"""音频特征提取 — 使用 librosa 分析试听片段（30-60s）
若试听音频不可用或 librosa 未安装，返回降级结果（audio_analysis: false）
"""
import math
import tempfile
import urllib.request

import numpy as np

try:
    import librosa
    _HAS_LIBROSA = True
except Exception:  # pragma: no cover
    _HAS_LIBROSA = False


class AudioAnalysisError(Exception):
    pass


def _download(url: str, timeout: float = 25.0) -> bytes:
    """下载音频返回字节。失败抛 AudioAnalysisError。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:
        raise AudioAnalysisError(f"试听音频下载失败: {e}") from e


def _read_audio(data: bytes):
    """librosa 加载音频字节 → (y, sr)。"""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            y, sr = librosa.load(tmp_path, sr=None, mono=True)
            return y, sr
        finally:
            import os
            os.unlink(tmp_path)
    except Exception as e:
        raise AudioAnalysisError(f"音频解码失败: {e}") from e


def _rms_curve(y, sr, frame_length=2048, hop_length=512) -> np.ndarray:
    """RMS 能量包络（一维数组，按帧）"""
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    return rms


def _segment_rms(rms, sr, hop_length, start, end):
    """某时间区间 [start, end] 秒内的平均 RMS。区间无内容返回 None。"""
    if end <= start:
        return None
    f0 = int(start * sr / hop_length)
    f1 = int(end * sr / hop_length)
    seg = rms[max(0, f0):max(0, f1)]
    if seg.size == 0:
        return None
    return float(np.mean(seg))


def analyze_preview(audio_bytes: bytes, lyric_analysis=None) -> dict:
    """分析试听音频，返回特征字典。

    lyric_analysis: LyricAnalysis 对象（用于段落响度对比、前奏响度）
    返回 dict: {bpm, rms, chorus_loudness_ratio, intro_rms, section_rms}
    """
    y, sr = _read_audio(audio_bytes)
    # 防止过大音频
    max_dur = 75.0
    if len(y) / sr > max_dur:
        y = y[: int(max_dur * sr)]

    # BPM
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(tempo)
    if bpm is None or math.isnan(bpm) or bpm <= 0 or bpm > 300:
        bpm = 0.0

    rms = _rms_curve(y, sr)
    seconds = len(y) / sr

    # 时间轴
    hop = 512
    n_frames = rms.shape[0]

    # 波形数据（前端绘制能量波形图，稀疏采样 ~120 点）
    step = max(1, n_frames // 120)
    wave = []
    for i in range(0, n_frames, step):
        v = float(rms[i])
        if not math.isnan(v) and v > 0:
            v_db = 20 * math.log10(v + 1e-10)
            v_db = max(-90.0, v_db)
            norm = (v_db + 90.0) / 90.0
        else:
            norm = 0.0
        wave.append(round(norm, 4))

    result = {
        "bpm": round(bpm, 1),
        "duration_seconds": round(seconds, 1),
        "waveform": wave,
        "rms": [round(float(x), 4) for x in rms.tolist()[::step]],
    }

    # 如果没有歌词分析，跳过响度对比
    chorus_loudness_ratio = None
    intro_rms = None
    if lyric_analysis is not None and lyric_analysis.has_lyric:
        intro_end = min(lyric_analysis.intro_seconds, seconds)
        intro_rms = _segment_rms(rms, sr, hop, 0, intro_end)

        # 副歌段平均响度 / 主歌段平均响度 → 爆发力
        chorus_rms_total = 0.0
        chorus_rms_count = 0
        verse_rms_total = 0.0
        verse_rms_count = 0
        # 使用 lyric_analysis 提供的 chorus/verse 区间列表（由 pipeline 注入）
        for start, end in getattr(lyric_analysis, "chorus_intervals", []):
            m = _segment_rms(rms, sr, hop, start, end)
            if m is not None:
                chorus_rms_total += m
                chorus_rms_count += 1
        for start, end in getattr(lyric_analysis, "verse_intervals", []):
            m = _segment_rms(rms, sr, hop, start, end)
            if m is not None:
                verse_rms_total += m
                verse_rms_count += 1
        if chorus_rms_count and verse_rms_count:
            chorus_avg = chorus_rms_total / chorus_rms_count
            verse_avg = verse_rms_total / verse_rms_count
            if verse_avg > 0:
                chorus_loudness_ratio = round(chorus_avg / verse_avg, 4)

    result["chorus_loudness_ratio"] = chorus_loudness_ratio
    result["intro_rms"] = intro_rms
    return result


def download_audio(url: str, timeout: float = 25.0) -> bytes:
    return _download(url, timeout)


def has_librosa() -> bool:
    return _HAS_LIBROSA