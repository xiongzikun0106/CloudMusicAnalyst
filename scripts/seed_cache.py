#!/usr/bin/env python3
"""缓存造数脚本：向卡片缓存注入 N 份随机卡片，用于验证 FIFO 裁剪与排面计算。

用法:
  python scripts/seed_cache.py --count 120
  python scripts/seed_cache.py --count 120 --clear   # 先清空再注入
"""
import argparse
import datetime as dt
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import ranking  # noqa: E402

ELEMENTS = ["火", "水", "风", "雷", "木", "暗", "其他"]
TITLES = ["恒星", "浪潮", "疾风", "雷暴", "森林", "暗夜", "烈焰", "心海", "自由", "钢铁", "星河", "逆光"]


def make_card(i: int, seed: int = None) -> dict:
    if seed is not None:
        random.seed(seed + i)
    elem = random.choice(ELEMENTS)
    return {
        "song": {
            "id": 100000 + i,
            "title": f"{random.choice(TITLES)}{i}号",
            "artist": "测试歌手",
            "album": "测试专辑",
            "genre_tags": [],
            "duration_seconds": random.randint(180, 360),
            "duration_text": "",
            "lyric_url": "",
            "preview_url": "",
        },
        "analysis": {
            "bpm": round(random.uniform(60, 190), 1),
            "section_count": random.randint(4, 12),
            "chorus_count": random.randint(1, 4),
            "chorus_ratio": round(random.uniform(0.1, 0.6), 4),
            "intro_seconds": round(random.uniform(0, 30), 1),
            "first_chorus_seconds": round(random.uniform(20, 120), 1),
            "chorus_loudness_ratio": round(random.uniform(1.0, 1.8), 4),
            "structure_type": random.choice(["循环爆发型", "副歌主导型", "均衡段落型"]),
            "audio_analysis": True,
        },
        "battle_card": {
            "element": elem,
            "element_evidence": "测试依据",
            "attack_speed": round(random.uniform(0.6, 1.8), 2),
            "burst": round(random.uniform(0.4, 1.0), 2),
            "charge_time_seconds": round(random.uniform(1, 30), 1),
            "cooldown_text": "",
            "cooldown_seconds": random.randint(180, 360),
            "skill_name": "测试技能",
            "skill_description": "测试技能描述，用于填充缓存数据。",
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="向卡片缓存注入测试数据")
    parser.add_argument("--count", type=int, default=120, help="注入数量（默认 120，超过 100 触发 FIFO 裁剪）")
    parser.add_argument("--clear", action="store_true", help="注入前先清空缓存")
    args = parser.parse_args()

    if args.clear:
        removed = 0
        for suffix in ("", "-wal", "-shm"):
            p = ranking.CACHE_FILE + suffix
            if os.path.exists(p):
                os.remove(p)
                removed += 1
        if removed:
            print(f"已清空缓存: {ranking.CACHE_FILE}")

    new_cards = [make_card(i) for i in range(args.count)]
    existing = ranking.load_cards()
    existing.extend(new_cards)
    ranking.save_cards(existing)

    cards = ranking.load_cards()
    print(f"注入 {args.count} 份 → 缓存现在共 {len(cards)} 份（上限 {ranking.MAX_CACHE}）")
    if len(cards) > ranking.MAX_CACHE:
        print("❌ 超过上限！FIFO 裁剪异常")
        sys.exit(1)
    print(f"✅ FIFO 裁剪正常，最旧卡片 id={cards[0]['song']['id']}（若裁剪则 >100000）")


if __name__ == "__main__":
    main()