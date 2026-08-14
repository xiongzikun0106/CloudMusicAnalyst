"""排面层 — 属性卡存储（SQLite，song_id 唯一）+ 排名/百分位计算

存储：SQLite 单文件（默认 data/cards_cache.db，可用 CACHE_FILE 环境变量覆盖）
  - 表 cards(song_id INTEGER PRIMARY KEY, title TEXT, artist TEXT,
             card_json TEXT, generated_at TEXT)
  - song_id 唯一约束：同一首歌重复分析时执行 upsert（覆盖旧卡），不产生重复行
  - 容量上限 100：写入后按 generated_at 升序裁剪最旧（FIFO）
  - 并发：单连接 + 线程锁（读-改-写整体加锁），WAL 模式 + 原子事务
  - 首次启动若发现旧版 JSONL（cards_cache.jsonl 且 DB 为空）自动导入迁移，
    迁移完成后旧文件重命名为 cards_cache.jsonl.imported

百分位口径：percentile = (rank - 1) / max(sample_count - 1, 1) * 100
  即「优于多少比例的样本」；当只有 1 份样本时（自己），percentile = 100。
  单项排名规则：值越大排名越靠前（rank=1 为最优）。
  唯一例外：cooldown_seconds（冷却越短排名越高）。

综合战力分：score = attack_speed * 0.4 + burst * 0.4 + chorus_ratio * 0.2
  其中 attack_speed、burst 已归一化到 0~2 区间，chorus_ratio 本身 0~1，
  因此 score 的取值范围约为 0~1.6，仅用于相对排名，不对外声称绝对可解释。
"""
import json
import os
import sqlite3
import threading

DB_FILE = os.environ.get("CACHE_FILE", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cards_cache.db"
))
MAX_CACHE = 100

# 兼容旧代码引用：CACHE_FILE 为权威路径（可被测试/脚本重写），
# DB_FILE 仅为导入期别名，实际读写一律读取 CACHE_FILE 的当前值
CACHE_FILE = DB_FILE

_LOCK = threading.Lock()
_CONN = None
_CONN_PATH = None

# 单项排名维度（key → (字段路径, 是否越大越好)）
DIM_DEFS = {
    "attack_speed": (["battle_card", "attack_speed"], True),
    "burst": (["battle_card", "burst"], True),
    "bpm": (["analysis", "bpm"], True),
    "chorus_ratio": (["analysis", "chorus_ratio"], True),
    "cooldown_seconds": (["battle_card", "cooldown_seconds"], False),  # 越短越好
}


def _ensure_dir(path: str):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


def _legacy_jsonl_path() -> str:
    """旧版 JSONL 缓存路径（与 DB 同目录同名，扩展名 .jsonl）"""
    return os.path.splitext(CACHE_FILE)[0] + ".jsonl"


def _insert_card(conn: sqlite3.Connection, card: dict):
    """upsert 一张卡片：song_id 相同则覆盖旧卡（不再产生重复行）。"""
    song = card.get("song") or {}
    song_id = song.get("id")
    if song_id is None:
        return
    conn.execute(
        """INSERT INTO cards (song_id, title, artist, card_json, generated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(song_id) DO UPDATE SET
             title        = excluded.title,
             artist       = excluded.artist,
             card_json    = excluded.card_json,
             generated_at = excluded.generated_at""",
        (
            int(song_id),
            str(song.get("title") or ""),
            str(song.get("artist") or ""),
            json.dumps(card, ensure_ascii=False),
            str(card.get("generated_at") or ""),
        ),
    )


def _trim(conn: sqlite3.Connection):
    """FIFO 裁剪：超过 MAX_CACHE 时删除 generated_at 最旧的行。"""
    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    if total <= MAX_CACHE:
        return
    overflow = total - MAX_CACHE
    conn.execute(
        "DELETE FROM cards WHERE song_id IN ("
        "  SELECT song_id FROM cards ORDER BY generated_at ASC, song_id ASC LIMIT ?"
        ")",
        (overflow,),
    )


def _migrate_legacy_jsonl(conn: sqlite3.Connection):
    """旧版 JSONL → SQLite 一次性迁移（DB 为空且存在旧文件时执行）。"""
    legacy = _legacy_jsonl_path()
    if not os.path.exists(legacy):
        return
    # 防御：DB 文件本身不带 .db 扩展名时，legacy 路径可能等于 CACHE_FILE（避免把 DB 当 JSONL 读）
    if os.path.abspath(legacy) == os.path.abspath(CACHE_FILE):
        return
    try:
        count = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    except sqlite3.Error:
        return
    if count > 0:
        return
    imported = 0
    try:
        with open(legacy, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not (isinstance(obj, dict) and "song" in obj and "battle_card" in obj):
                    continue
                _insert_card(conn, obj)
                imported += 1
        conn.commit()
    except (OSError, sqlite3.Error):
        return
    if imported:
        try:
            _trim(conn)
            conn.commit()
        except sqlite3.Error:
            return
        try:
            os.rename(legacy, legacy + ".imported")
        except OSError:
            pass


def close_db():
    """关闭当前数据库连接（测试/脚本清理用）。"""
    global _CONN, _CONN_PATH
    with _LOCK:
        if _CONN is not None:
            try:
                _CONN.close()
            except sqlite3.Error:
                pass
            _CONN = None
            _CONN_PATH = None


def _get_conn() -> sqlite3.Connection:
    global _CONN, _CONN_PATH
    if _CONN is None or _CONN_PATH != CACHE_FILE:
        if _CONN is not None:
            try:
                _CONN.close()
            except sqlite3.Error:
                pass
        _ensure_dir(CACHE_FILE)
        conn = sqlite3.connect(CACHE_FILE, check_same_thread=False, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cards (
                song_id      INTEGER PRIMARY KEY,
                title        TEXT NOT NULL DEFAULT '',
                artist       TEXT NOT NULL DEFAULT '',
                card_json    TEXT NOT NULL,
                generated_at TEXT NOT NULL
            )
        """)
        conn.commit()
        _CONN = conn
        _CONN_PATH = CACHE_FILE
        _migrate_legacy_jsonl(conn)
    return _CONN


def load_cards() -> list:
    """读取全部卡片（按写入时间升序，同一首歌只保留最新一份）"""
    with _LOCK:
        try:
            conn = _get_conn()
            rows = conn.execute(
                "SELECT card_json FROM cards ORDER BY generated_at ASC, song_id ASC"
            ).fetchall()
        except sqlite3.Error:
            return []
        cards = []
        for (row,) in rows:
            try:
                obj = json.loads(row)
                if isinstance(obj, dict) and "song" in obj and "battle_card" in obj:
                    cards.append(obj)
            except json.JSONDecodeError:
                continue
        return cards


def save_cards(cards: list):
    """全量覆写（供测试/造数脚本使用），保留 FIFO 裁剪。"""
    with _LOCK:
        _ensure_dir(CACHE_FILE)
        conn = _get_conn()
        with conn:
            conn.execute("DELETE FROM cards")
            for card in cards:
                _insert_card(conn, card)
            _trim(conn)


def append_card(card: dict):
    """写入一张卡片：同 song_id 覆盖旧卡（upsert），随后 FIFO 裁剪到 MAX_CACHE。

    先比较后写入（保证自己不与自己做比较）的逻辑由调用方（pipeline）控制。
    """
    with _LOCK:
        _ensure_dir(CACHE_FILE)
        conn = _get_conn()
        with conn:
            _insert_card(conn, card)
            _trim(conn)


def _deep_get(obj: dict, path: list):
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


def _rank_value(cards: list, dimension: str, value):
    """计算某维度值的排名（1-based）。higher_is_better=True 时值越大越好。"""
    _, higher_is_better = DIM_DEFS[dimension]
    if value is None:
        return None
    # 与传入样本比较：比自己好的数量（样本中不含自身）
    better_count = 0
    for c in cards:
        other = _deep_get(c, DIM_DEFS[dimension][0])
        if other is None:
            continue
        if higher_is_better:
            if other > value:
                better_count += 1
        else:
            if other < value:
                better_count += 1
    rank = better_count + 1
    return rank


def _percentile(rank, n):
    """percentile = (rank-1) / max(n-1, 1) * 100，保留 1 位小数"""
    if n <= 1:
        return 100.0
    return round((rank - 1) / (n - 1) * 100, 1)


def _best_str(cards: list, dimension: str, exclude_id=None):
    """返回该维度最优样本的描述字符串（不含被排除的卡片）"""
    if not cards:
        return ""
    higher_is_better = DIM_DEFS[dimension][1]
    best_card = None
    best_val = None
    for c in cards:
        cid = (c.get("song") or {}).get("id")
        if cid is not None and cid == exclude_id:
            continue
        val = _deep_get(c, DIM_DEFS[dimension][0])
        if val is None:
            continue
        if best_val is None:
            best_val = val
            best_card = c
            continue
        if (higher_is_better and val > best_val) or (not higher_is_better and val < best_val):
            best_val = val
            best_card = c
    if best_card is None:
        return ""
    title = (best_card.get("song") or {}).get("title") or "未知"
    return f"《{title}》{best_val}"


def _overall_score(card: dict) -> float:
    """综合战力分公式（确定性）：
    score = attack_speed * 0.4 + burst * 0.4 + chorus_ratio * 0.2
    """
    as_ = _deep_get(card, ["battle_card", "attack_speed"]) or 0
    burst = _deep_get(card, ["battle_card", "burst"]) or 0
    cr = _deep_get(card, ["analysis", "chorus_ratio"]) or 0
    return as_ * 0.4 + burst * 0.4 + cr * 0.2


def compute_ranking(new_card: dict, cards_without_self: list) -> dict:
    """计算新卡片的排面。

    cards_without_self: 缓存中除自身外的卡片（用于比较与 best 描述）
    满足：比较完成后再写入缓存，保证自己不与自己做比较。
    """
    n = len(cards_without_self) + 1  # 样本数 = 已有 + 自己

    dimensions = {}
    for dim in DIM_DEFS:
        val = _deep_get(new_card, DIM_DEFS[dim][0])
        if val is None:
            continue
        rank = _rank_value(cards_without_self, dim, val)
        if rank is None:
            continue
        dimensions[dim] = {
            "rank": rank,
            "percentile": _percentile(rank, n),
            "best": _best_str(cards_without_self, dim, exclude_id=(new_card.get("song") or {}).get("id")),
        }

    # 综合战力
    score = _overall_score(new_card)
    scores = [_overall_score(c) for c in cards_without_self]
    better = sum(1 for s in scores if s > score)
    overall_rank = better + 1
    overall = {
        "score": round(score, 4),
        "rank": overall_rank,
        "percentile": _percentile(overall_rank, n),
    }

    # 系别分布（基于全部缓存样本 + 自己）
    element_distribution = {}
    all_cards = cards_without_self + [new_card]
    for c in all_cards:
        elem = (c.get("battle_card") or {}).get("element") or "其他"
        element_distribution[elem] = element_distribution.get(elem, 0) + 1

    # note
    notes = []
    if n == 1:
        notes.append("暂无足够样本")
    if not (new_card.get("analysis") or {}).get("audio_analysis", True):
        notes.append("含 1 份无音频样本")
    no_audio_count = sum(1 for c in cards_without_self if not (c.get("analysis") or {}).get("audio_analysis", True))
    if no_audio_count:
        notes.append(f"含 {no_audio_count} 份无音频样本")

    return {
        "sample_count": n,
        "dimensions": dimensions,
        "overall": overall,
        "element_distribution": element_distribution,
        "note": "；".join(notes),
    }


