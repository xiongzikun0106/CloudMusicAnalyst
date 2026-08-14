"""歌词结构解析 — 纯文本处理，基于 LRC 时间戳切分段落并识别副歌"""
import re
from dataclasses import dataclass


@dataclass
class LyricLine:
    time: float  # 秒
    text: str


@dataclass
class LyricSection:
    index: int
    start_time: float
    end_time: float
    lines: list  # [LyricLine]
    is_chorus: bool = False


@dataclass
class LyricAnalysis:
    section_count: int = 0
    chorus_count: int = 0
    chorus_ratio: float = 0.0          # 副歌行数 / 总行数
    intro_seconds: float = 0.0         # 首句歌词时间（前奏长度）
    first_chorus_seconds: float = 0.0  # 副歌首次出现时间
    duration: float = 0.0              # 最后一句时间
    structure_type: str = "未知"
    has_lyric: bool = False
    full_text: str = ""
    sections: list = None              # [LyricSection]，供音频分析注入区间
    chorus_intervals: list = None      # [(start, end)] 副歌时间区间
    verse_intervals: list = None       # [(start, end)] 主歌时间区间


# ---------- LRC 解析 ----------

_TIME_TAG = re.compile(r"\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]")


# 常见 LRC 元数据关键词（时间戳后的内容若以此开头则判定为元数据行）
_META_KEYWORDS = (
    "作词", "作曲", "编曲", "制作", "混音", "母带", "监制", "录音",
    "吉他", "贝斯", "鼓", "键盘", "小提琴", "和声", "program", "producer",
    "op", "sp", "原曲", "原唱", "翻唱", "词：", "曲：",
)


def _is_meta_line(text: str) -> bool:
    """判断是否为元数据行（如 作词 : xxx / 作曲：xxx / 编曲:xxx）"""
    t = text.strip().lstrip("[").strip()
    if not t:
        return True
    # 纯元数据头行（无时间戳歌词内容）
    if re.match(r"^(作词|作曲|编曲|制作|混音|母带|监制|录音|原曲|原唱|翻唱)[\s:：]+", t):
        return True
    for kw in _META_KEYWORDS:
        if t.lower().startswith(kw.lower()):
            return True
    return False


def parse_lrc(lrc_text: str) -> list:
    """解析 LRC 文本 → [LyricLine]，按时间排序。无时间戳行/元数据行被忽略。"""
    lines = []
    for raw in lrc_text.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        # 元数据头行 [ti:xxx] / [ar:xxx] 等（无时间戳）
        if raw.startswith("[") and re.match(r"^\[\w+:", raw) and not _TIME_TAG.match(raw):
            continue
        matches = _TIME_TAG.findall(raw)
        if not matches:
            continue
        text = _TIME_TAG.sub("", raw).strip()
        # 过滤带时间戳的元数据内容行（如 [00:00.00] 作词 : 测试）
        if _is_meta_line(text):
            continue
        for mm, ss, ms in matches:
            minutes = int(mm)
            seconds = int(ss)
            frac = ms if ms else "0"
            # 毫秒可能是 1-3 位
            ms_val = int(frac.ljust(3, "0")[:3])
            t = minutes * 60 + seconds + ms_val / 1000.0
            lines.append(LyricLine(time=t, text=text))
    lines.sort(key=lambda x: x.time)
    return lines


def _normalize(text: str) -> str:
    """归一化用于相似度比较：去除非中英数字字符"""
    s = re.sub(r"[^\w\u4e00-\u9fff]", "", text.lower())
    return s.strip()


def _similarity(a: str, b: str) -> float:
    a = _normalize(a)
    b = _normalize(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # 最长公共子串比例
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    best = 0
    for i in range(len(short)):
        for j in range(i + 1, len(short) + 1):
            if short[i:j] in long:
                best = max(best, j - i)
    return best / max(len(long), 1)


def _dedup_consecutive(lines: list) -> list:
    """合并连续重复的行（同歌曲重复出现的歌词标记），保留首次出现。"""
    out = []
    for ln in lines:
        if out and _similarity(out[-1].text, ln.text) >= 0.95:
            continue
        out.append(ln)
    return out


def _lines_overlap_ratio(a: list, b: list, threshold: float = 0.6) -> float:
    """行级重叠比例：b 中的行有多少能在 a 中找到相似行（去重后）。
    按较短段落行数归一化，返回 0~1。"""
    a_norm = [_normalize(l.text) for l in a]
    b_norm = [_normalize(l.text) for l in b]
    if not a_norm or not b_norm:
        return 0.0
    matched = 0
    used_a = set()
    for bn in b_norm:
        if not bn:
            continue
        for ai, an in enumerate(a_norm):
            if ai in used_a or not an:
                continue
            if an == bn or _similarity(an, bn) >= 0.8:
                matched += 1
                used_a.add(ai)
                break
    denominator = max(min(len(a), len(b)), 1)
    return matched / denominator


def _identify_chorus_sections(sections: list) -> list:
    """对段落做相似度聚类：互相高度相似的段落标记为副歌。

    判定规则（满足其一）：
    - 整段文本相似度 >= 0.6
    - 行级重叠比例 >= 0.6（允许段落含少量不同的过渡行）
    """
    chorus_indices = set()
    for i in range(len(sections)):
        for j in range(i + 1, len(sections)):
            si_text = "".join(l.text for l in sections[i].lines)
            sj_text = "".join(l.text for l in sections[j].lines)
            sim = _similarity(si_text, sj_text)
            overlap = _lines_overlap_ratio(sections[i].lines, sections[j].lines)
            if sim >= 0.6 or overlap >= 0.6:
                chorus_indices.add(i)
                chorus_indices.add(j)
    for k in chorus_indices:
        sections[k].is_chorus = True
    return sections


def analyze_lyric(lrc_text: str) -> LyricAnalysis:
    """完整歌词结构分析。"""
    result = LyricAnalysis()
    result.full_text = lrc_text
    lines = parse_lrc(lrc_text)
    if not lines:
        result.has_lyric = False
        return result
    result.has_lyric = True

    lines = _dedup_consecutive(lines)
    result.intro_seconds = lines[0].time
    result.duration = lines[-1].time

    # 段落切分：时间间隔 > 6 秒视为段落边界（歌词行间距通常 2-5 秒）
    sections = []
    current = []
    current_start = None
    prev_time = None
    for ln in lines:
        if current_start is None:
            current_start = ln.time
            current = [ln]
            prev_time = ln.time
            continue
        gap = ln.time - prev_time
        if gap > 6.0 and current:
            sections.append(LyricSection(
                index=len(sections),
                start_time=current_start,
                end_time=prev_time,
                lines=current,
            ))
            current = [ln]
            current_start = ln.time
        else:
            current.append(ln)
        prev_time = ln.time
    if current:
        sections.append(LyricSection(
            index=len(sections),
            start_time=current_start,
            end_time=prev_time,
            lines=current,
        ))

    if not sections:
        # 整首视为一个段落
        sections.append(LyricSection(0, lines[0].time, lines[-1].time, lines))

    sections = _identify_chorus_sections(sections)
    result.sections = sections
    result.section_count = len(sections)
    result.chorus_count = sum(1 for s in sections if s.is_chorus)

    total_lines = sum(len(s.lines) for s in sections)
    chorus_lines = sum(len(s.lines) for s in sections if s.is_chorus)
    result.chorus_ratio = round(chorus_lines / total_lines, 4) if total_lines else 0.0

    chorus_sections = [s for s in sections if s.is_chorus]
    if chorus_sections:
        result.first_chorus_seconds = round(min(s.start_time for s in chorus_sections), 2)

    # 结构类型判定
    ratio = result.chorus_ratio
    if result.chorus_count >= 3 and ratio >= 0.5:
        result.structure_type = "循环爆发型"
    elif ratio >= 0.35:
        result.structure_type = "副歌主导型"
    elif result.chorus_count == 0:
        result.structure_type = "自由叙事型"
    elif ratio < 0.2:
        result.structure_type = "主歌叙事型"
    else:
        result.structure_type = "均衡段落型"

    return result