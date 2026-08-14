#!/usr/bin/env python3
"""排面单元测试 — 手工构造已知数值的卡片，验证排名/百分位与手算一致。

用法: python scripts/test_ranking.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import ranking  # noqa: E402


def _make_card(song_id: int, title: str, attack_speed: float, burst: float,
               bpm: float, chorus_ratio: float, cooldown: int, element: str = "火") -> dict:
    return {
        "song": {"id": song_id, "title": title, "artist": "测试"},
        "analysis": {"bpm": bpm, "chorus_ratio": chorus_ratio, "audio_analysis": True},
        "battle_card": {
            "element": element,
            "attack_speed": attack_speed,
            "burst": burst,
            "cooldown_seconds": cooldown,
        },
    }


def test_percentile_formula():
    """percentile = (rank-1) / max(n-1, 1) * 100"""
    assert ranking._percentile(1, 1) == 100.0      # 唯一样本
    assert ranking._percentile(1, 3) == 0.0        # 第 1 名 / 3 人
    assert ranking._percentile(2, 3) == 50.0       # 第 2 名 / 3 人 → (2-1)/(3-1)=50%
    assert ranking._percentile(3, 3) == 100.0      # 第 3 名 / 3 人
    print("✅ test_percentile_formula 通过")


def test_ranking_hand_calculated():
    """手工构造 2 份已知数值卡片，验证排名/百分位与手算一致。

    玩家 A: attack_speed=1.8, burst=0.9（最强）
    玩家 B: attack_speed=1.2, burst=0.5
    新卡片: attack_speed=1.5, burst=0.7
    → attack_speed: A(1.8)>新(1.5)>B(1.2) → 新 rank=2/3, pct=50%
    → burst: A(0.9)>新(0.7)>B(0.5) → 新 rank=2/3, pct=50%
    """
    existing = [
        _make_card(1, "A", 1.8, 0.9, 140, 0.4, 300),
        _make_card(2, "B", 1.2, 0.5, 90, 0.2, 240),
    ]
    new = _make_card(3, "NEW", 1.5, 0.7, 120, 0.3, 280)

    r = ranking.compute_ranking(new, existing)

    assert r["sample_count"] == 3
    # attack_speed: 1.5 在 [1.8,1.2,1.5] 中排第 2
    assert r["dimensions"]["attack_speed"]["rank"] == 2
    assert r["dimensions"]["attack_speed"]["percentile"] == 50.0
    # burst: 0.7 在 [0.9,0.5,0.7] 中排第 2
    assert r["dimensions"]["burst"]["rank"] == 2
    assert r["dimensions"]["burst"]["percentile"] == 50.0
    # bpm: 120 在 [140,90,120] 中排第 2
    assert r["dimensions"]["bpm"]["rank"] == 2
    # cooldown: 280 越短越好 → [240,300,280] 中排第 2（240 最短第 1）
    assert r["dimensions"]["cooldown_seconds"]["rank"] == 2
    # best 描述应指向 A
    assert "《A》1.8" in r["dimensions"]["attack_speed"]["best"]
    print("✅ test_ranking_hand_calculated 通过")


def test_ranking_self_not_compared():
    """自己不与自己做比较：新卡片 unique 值应 rank=1"""
    existing = [
        _make_card(1, "A", 1.8, 0.9, 140, 0.4, 300),
    ]
    new = _make_card(2, "UNIQUE", 2.0, 1.0, 200, 0.8, 500)
    r = ranking.compute_ranking(new, existing)
    assert r["sample_count"] == 2
    assert r["dimensions"]["attack_speed"]["rank"] == 1
    assert r["dimensions"]["attack_speed"]["percentile"] == 0.0
    assert r["dimensions"]["burst"]["rank"] == 1
    print("✅ test_ranking_self_not_compared 通过")


def test_ranking_first_card():
    """第一份卡片：note 提示暂无足够样本"""
    new = _make_card(1, "FIRST", 1.0, 0.6, 120, 0.3, 240)
    r = ranking.compute_ranking(new, [])
    assert r["sample_count"] == 1
    assert r["dimensions"]["attack_speed"]["rank"] == 1
    assert r["dimensions"]["attack_speed"]["percentile"] == 100.0
    assert "暂无足够样本" in r["note"]
    print("✅ test_ranking_first_card 通过")




def test_dedup_by_song_id():
    """同一首歌重复写入：只保留一份，且后写入覆盖旧值（不再重复储存）。"""
    tmpdir = tempfile.mkdtemp()
    cache_file = os.path.join(tmpdir, "cards_cache.db")
    old_file = ranking.CACHE_FILE
    ranking.CACHE_FILE = cache_file
    try:
        c1 = _make_card(7, "同一首歌", 1.0, 0.5, 100, 0.3, 240)
        c2 = _make_card(7, "同一首歌", 1.9, 0.9, 180, 0.6, 300)
        ranking.append_card(c1)
        ranking.append_card(c2)
        cards = ranking.load_cards()
        assert len(cards) == 1, f"应只有 1 份卡片，实际 {len(cards)}"
        assert cards[0]["battle_card"]["attack_speed"] == 1.9
        assert cards[0]["battle_card"]["burst"] == 0.9
        print("✅ test_dedup_by_song_id 通过")
    finally:
        ranking.CACHE_FILE = old_file
        ranking.close_db()
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(cache_file + suffix):
                os.remove(cache_file + suffix)
        os.rmdir(tmpdir)


def test_fifo_cap():
    """FIFO 裁剪：注入 150 份，缓存恰好 100 份，最旧的被丢弃"""
    tmpdir = tempfile.mkdtemp()
    cache_file = os.path.join(tmpdir, "cards_cache.db")
    old_file = ranking.CACHE_FILE
    ranking.CACHE_FILE = cache_file

    try:
        for i in range(150):
            card = _make_card(i, f"Card{i}", 1.0, 0.5, 120, 0.3, 240)
            existing = ranking.load_cards()
            existing.append(card)
            ranking.save_cards(existing)

        cards = ranking.load_cards()
        assert len(cards) == ranking.MAX_CACHE == 100
        # 最新的 50~149 保留，0~49 被丢弃
        assert cards[0]["song"]["id"] == 50
        assert cards[-1]["song"]["id"] == 149
    finally:
        ranking.CACHE_FILE = old_file
        ranking.close_db()
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(cache_file + suffix):
                os.remove(cache_file + suffix)
        os.rmdir(tmpdir)
    print("✅ test_fifo_cap 通过")


if __name__ == "__main__":
    test_percentile_formula()
    test_ranking_hand_calculated()
    test_ranking_self_not_compared()
    test_ranking_first_card()
    test_dedup_by_song_id()
    test_fifo_cap()
    print("\n🎉 全部排面单元测试通过")