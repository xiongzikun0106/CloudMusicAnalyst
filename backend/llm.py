"""LLM 属性生成 — 调用 DeepSeek API 生成系别/技能描述

严格校验输出并回退到规则默认值：
 - BPM 映射、响度对比、段落占比 等数值由 pipeline/analyze 层确定性计算（代码兜底）
 - LLM 仅负责：系别（元素）、系别依据、技能名称、技能描述 的语义生成
"""
import json
import os
import re

import httpx

try:
    import tiktoken
    _HAS_TIKTOKEN = True
except Exception:  # pragma: no cover
    _HAS_TIKTOKEN = False

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com/v1/chat/completions")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
LLM_ENABLED = os.environ.get("LLM_ENABLED", "1").lower() in ("1", "true", "yes")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "60"))


class LLMError(Exception):
    pass


# ---------- 规则回退（无 LLM 或 LLM 失败时） ----------

_ELEMENT_KEYWORDS = {
    "火": ["燃烧", "火焰", "火海", "烈火", "呐喊", "嘶吼", "热血", "沸腾", "炽热", "烈焰", "火山", "焚", "燃", "shout", "fire", "burn", "flame"],
    "水": ["大海", "海浪", "潮汐", "海洋", "星空", "行星", "宇宙", "银河", "眼泪", "雨滴", "下雨", "水", "海", "星", "ocean", "sea", "rain", "star"],
    "风": ["流浪", "远方", "飞翔", "自由", "风筝", "风", "奔跑", "上路", "旅行", "wind", "fly", "wander", "free"],
    "雷": ["钢铁", "机械", "电路", "闪电", "雷", "霓虹", "城市", "引擎", "赛博", "电子", "电机", "信号", "lightning", "steel", "machine", "city"],
    "木": ["自然", "森林", "树木", "花园", "春天", "野花", "草地", "绿叶", "种子", "森林", "tree", "forest", "nature", "spring"],
    "暗": ["黑暗", "夜晚", "深夜", "影子", "阴影", "魔鬼", "孤独", "深渊", "暗", "黑", "夜", "shadow", "dark", "night", "lonely", "abyss"],
}

_DEFAULT_STRUCTURE_DESC = {
    "循环爆发型": "副歌反复轰炸、能量不断叠加",
    "副歌主导型": "副歌占据大量篇幅、感染力极强",
    "主歌叙事型": "以叙事铺陈为主、情感层层递进",
    "均衡段落型": "主副歌张弛有度、节奏把控精准",
    "自由叙事型": "没有固定副歌、自由流淌的情绪流",
    "未知": "结构自由、充满实验性",
}


def _infer_element_rule(lyric_text: str) -> tuple:
    """规则兜底：根据歌词关键词推断系别。返回 (系别, 依据)。"""
    if not lyric_text:
        return "其他", "无歌词可推断系别"
    lowest = lyric_text.lower()
    hits = {}
    for elem, kws in _ELEMENT_KEYWORDS.items():
        cnt = sum(1 for kw in kws if kw.lower() in lowest)
        if cnt:
            hits[elem] = cnt
    if hits:
        best = max(hits, key=hits.get)
        # 搜集命中的前 3 个关键词作证据
        kws_hit = [kw for kw in _ELEMENT_KEYWORDS[best] if kw.lower() in lowest][:3]
        return best, "歌词中出现" + "、".join(kws_hit) + "等意象"
    return "其他", "歌词主题不明显，归为其他系别"


def _default_skill_name(element: str, structure_type: str) -> str:
    return f"{element}系·{structure_type}"


def _default_skill_desc(element: str, structure_type: str, cooldown_text: str,
                        attack_speed: float, burst: float) -> str:
    struct_desc = _DEFAULT_STRUCTURE_DESC.get(structure_type, "结构独特")
    return (
        f"「{struct_desc}」。战斗中攻速 {attack_speed:.2f}、爆发力 {burst:.2f}，"
        f"蓄力完成后进入高能状态；冷却时间 {cooldown_text}。"
    )


# ---------- LLM 生成 ----------

_SYSTEM_PROMPT = """你是一位中二风格的音乐属性设定师。根据用户提供的歌曲特征 JSON，生成一张战斗 BGM 属性卡中的语义部分。
只输出一个 JSON 对象，不要多余文字，不要 Markdown 代码块。必须严格包含以下字段：
{
  "element": "系别（只能从：火/水/风/雷/木/暗/其他 中选一个）",
  "element_evidence": "系别依据，30-60 字，从歌词主题或曲风说明为什么是这个系别",
  "skill_name": "技能名，中二但合理，10-20 字，可结合歌曲关键词",
  "skill_description": "技能描述，60-120 字，中二但合理，包含攻速/爆发力/蓄力/冷却的设定感描述"
}
注意：给定特征数值必须保留（attack_speed、burst、charge_time、cooldown 等数字已在输入中给出，直接引用），不要编造新的数值。"""


def _truncate_for_llm(text: str, max_chars: int = 4000) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n……（歌词过长已截断）"


def _count_tokens_approx(text: str) -> int:
    """粗略 token 估算（中文约 1 char/token，英文约 4 chars/token）"""
    if _HAS_TIKTOKEN:
        try:
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except Exception:
            pass
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    other = len(text) - cn
    return cn + other // 4


def _extract_json(text: str) -> dict:
    """从 LLM 输出中提取 JSON 对象（去除 markdown 代码块）"""
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?", "", s).strip()
        s = re.sub(r"```$", "", s).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", s, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    raise LLMError("LLM 输出不是合法 JSON")


def _validate_and_fix(data: dict, lyric_text: str, features: dict) -> dict:
    """校验/修复 LLM 输出的字段。非法字段回退到规则值。"""
    valid_elements = {"火", "水", "风", "雷", "木", "暗", "其他"}
    rule_elem, rule_evidence = _infer_element_rule(lyric_text)

    element = str(data.get("element", "")).strip()
    if element not in valid_elements:
        element = rule_elem

    evidence = str(data.get("element_evidence", "")).strip()
    if not evidence or len(evidence) < 5:
        evidence = rule_evidence
    if len(evidence) > 200:
        evidence = evidence[:200]

    skill_name = str(data.get("skill_name", "")).strip()
    if not skill_name or len(skill_name) > 40:
        skill_name = _default_skill_name(element, features.get("structure_type", "未知"))

    skill_desc = str(data.get("skill_description", "")).strip()
    if not skill_desc or len(skill_desc) < 20:
        skill_desc = _default_skill_desc(
            element,
            features.get("structure_type", "未知"),
            features.get("cooldown_text", "未知"),
            features.get("attack_speed", 1.0),
            features.get("burst", 0.5),
        )

    return {
        "element": element,
        "element_evidence": evidence,
        "skill_name": skill_name,
        "skill_description": skill_desc,
    }


def generate_battle_semantics(features: dict, lyric_text: str) -> dict:
    """生成系别/技能语义。LLM 不可用或失败则回退到规则。

    features: 包含 attack_speed/burst/cooldown_text/charge_time_seconds/structure_type/bpm 等
    """
    rule_result = {
        "element": _infer_element_rule(lyric_text)[0],
        "element_evidence": _infer_element_rule(lyric_text)[1],
        "skill_name": _default_skill_name(_infer_element_rule(lyric_text)[0], features.get("structure_type", "未知")),
        "skill_description": _default_skill_desc(
            _infer_element_rule(lyric_text)[0],
            features.get("structure_type", "未知"),
            features.get("cooldown_text", "未知"),
            features.get("attack_speed", 1.0),
            features.get("burst", 0.5),
        ),
    }

    if not LLM_ENABLED or not DEEPSEEK_API_KEY:
        return rule_result

    payload = {
        "song_title": features.get("title", ""),
        "artist": features.get("artist", ""),
        "bpm": features.get("bpm"),
        "duration_seconds": features.get("duration_seconds"),
        "genre_tags": features.get("genre_tags", []),
        "structure_type": features.get("structure_type", "未知"),
        "section_count": features.get("section_count"),
        "chorus_count": features.get("chorus_count"),
        "chorus_ratio": features.get("chorus_ratio"),
        "intro_seconds": features.get("intro_seconds"),
        "first_chorus_seconds": features.get("first_chorus_seconds"),
        "chorus_loudness_ratio": features.get("chorus_loudness_ratio"),
        "attack_speed": features.get("attack_speed"),
        "burst": features.get("burst"),
        "charge_time_seconds": features.get("charge_time_seconds"),
        "cooldown_text": features.get("cooldown_text"),
        "lyric_snippet": _truncate_for_llm(lyric_text or "", 3000),
    }
    user_content = json.dumps(payload, ensure_ascii=False)

    # token 保护
    if _count_tokens_approx(user_content) > 6000:
        user_content = user_content[:2000] + "\n……（内容过长已截断）"

    try:
        resp = httpx.post(
            DEEPSEEK_BASE,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": 800,
                "temperature": 0.9,
                "stream": False,
            },
            timeout=LLM_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        if not content:
            return rule_result
        parsed = _extract_json(content)
        return _validate_and_fix(parsed, lyric_text, features)
    except Exception:
        # 任何 LLM 异常都回退到规则
        return rule_result


# ---------- 战斗属性卡锐评（提示词工程） ----------

_CRITIC_SYSTEM_PROMPT = """你是一位毒舌但懂行的华语乐评人，专门点评别人的「人生/战斗 BGM 属性卡」。

你的风格要求：
1. 犀利幽默、有理有据，绝不空洞客套，不要写「总的来说」。
2. 必须引用具体数据说话：攻速、爆发力、冷却、BPM、副歌占比、排名/百分位、系别分布、技能名，以及歌词中的意象。
3. 结构：第一段犀利开场（吐槽或玩梗），第二段点出一个客观亮点（数据或歌词依据），第三段一句扎心总结。
4. 用词有梗、有记忆点，像朋友圈里毒舌但懂音乐的老友。
5. 120-250 字中文，禁止使用 Markdown 标题、列表、加粗符号。

输出为纯文本，不要 JSON，不要任何多余解释。"""


def _critic_user_prompt(features: dict, ranking_info: dict, lyric_snippet: str) -> str:
    """构造锐评的用户提示词：把属性/排面/歌词结构化注入。"""
    ranking_info = ranking_info or {}
    dims = (ranking_info.get("dimensions") or {}) if isinstance(ranking_info.get("dimensions"), dict) else {}
    overall = ranking_info.get("overall") or {}
    sample_count = ranking_info.get("sample_count", 1)
    element_dist = ranking_info.get("element_distribution") or {}
    dist_str = "、".join(f"{k}系×{v}" for k, v in element_dist.items()) if element_dist else "暂无"
    notes = ranking_info.get("note") or ""
    note_line = f"\n【说明】{notes}" if notes else ""
    audio_note = "含音频特征分析" if features.get("audio_analysis") else "无试听音频，降级为歌词结构分析"

    def dim_val(key, field):
        v = (dims.get(key) or {}).get(field)
        return v if v is not None else "—"

    return f"""请锐评以下这张「战斗 BGM 属性卡」：

【歌曲】《{features.get('title', '未知')}》 - {features.get('artist', '未知')}（时长 {features.get('cooldown_text', '--')}）
【系别】{features.get('element', '其他')}（依据：{features.get('element_evidence', '--')}）
【战斗属性】攻速 {features.get('attack_speed', '--')} / 爆发力 {features.get('burst', '--')} / 蓄力 {features.get('charge_time_seconds', '--')} 秒 / 冷却 {features.get('cooldown_text', '--')}
【技能】{features.get('skill_name', '--')}：{features.get('skill_description', '--')}
【音频分析】BPM {features.get('bpm', '--')}，副歌占比 {features.get('chorus_ratio', '--')}（{features.get('chorus_count', '--')} 段副歌 / {features.get('section_count', '--')} 段落），结构：{features.get('structure_type', '未知')}（{audio_note}）
【排面战况】共 {sample_count} 份样本：综合战力 {overall.get('score', '--')} 分，排名 {overall.get('rank', '--')}/{sample_count}（百分位 {overall.get('percentile', '--')}%）；攻速第 {dim_val('attack_speed', 'rank')}、爆发力第 {dim_val('burst', 'rank')}、BPM 第 {dim_val('bpm', 'rank')}{note_line}
【系别分布】{dist_str}
【歌词节选】
{lyric_snippet or '（无歌词）'}

请给出你的锐评。"""


def _default_review(features: dict, ranking_info: dict) -> str:
    """规则回退：用数值拼一条有内味的锐评（保证 LLM 不可用时功能可用）。"""
    ranking_info = ranking_info or {}
    overall = ranking_info.get("overall") or {}
    dims = (ranking_info.get("dimensions") or {}) if isinstance(ranking_info.get("dimensions"), dict) else {}
    sample_count = ranking_info.get("sample_count", 1)
    as_rank = (dims.get("attack_speed") or {}).get("rank")
    burst_rank = (dims.get("burst") or {}).get("rank")
    element = features.get("element", "其他")

    head = f"《{features.get('title', '未知')}》这张卡，系别定为「{element}」，"
    stats = f"攻速 {features.get('attack_speed', '--')}、爆发力 {features.get('burst', '--')}、冷却 {features.get('cooldown_text', '--')}——数据摆在这，品味真相已经藏不住了。"
    rank_part = f"当前 {sample_count} 份样本里综合战力排第 {overall.get('rank', '--')}（百分位 {overall.get('percentile', '--')}%）。"
    if as_rank:
        punch = f"攻速第 {as_rank}" + (f"、爆发力第 {burst_rank}" if burst_rank else "") + " 名，说穿了就是：BGM 规格可以，但真正开打时够不够燃，你自己心里没数吗？"
    else:
        punch = "说穿了就是：你选的 BGM 到底燃不燃，自己心里没数吗？"
    return head + stats + rank_part + punch


def generate_battle_review(features: dict, ranking_info: dict, lyric_text: str) -> str:
    """生成战斗属性卡锐评（纯文本）。

    - 通过 DeepSeek 生成（提示词见 _CRITIC_SYSTEM_PROMPT / _critic_user_prompt）
    - LLM 不可用 / 无 Key / 异常 / 输出过短时回退到规则模板
    """
    if not LLM_ENABLED or not DEEPSEEK_API_KEY:
        return _default_review(features, ranking_info)

    user_prompt = _critic_user_prompt(features, ranking_info, _truncate_for_llm(lyric_text or "", 1500))
    try:
        resp = httpx.post(
            DEEPSEEK_BASE,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": _CRITIC_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": 600,
                "temperature": 0.95,
                "stream": False,
            },
            timeout=LLM_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        if not content or len(content) < 30:
            return _default_review(features, ranking_info)
        return content
    except Exception:
        return _default_review(features, ranking_info)


def generate_battle_review_from_context(context: dict) -> str:
    """从已生成的 review_context 重新生成锐评（不重新分析、不写缓存）。"""
    context = context or {}
    features = context.get("features") or {}
    ranking_info = context.get("ranking") or {}
    lyric_snippet = context.get("lyric_snippet") or ""
    return generate_battle_review(features, ranking_info, lyric_snippet)
