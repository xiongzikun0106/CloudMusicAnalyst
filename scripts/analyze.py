#!/usr/bin/env python3
"""命令行 demo：python analyze.py "歌名/链接/ID"，输出属性卡 JSON"""
import json
import os
import sys

# 让 backend 包可被导入
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import pipeline  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print("用法: python analyze.py \"歌名 或 网易云链接 或 歌曲ID\"")
        sys.exit(1)
    text = " ".join(sys.argv[1:])
    try:
        result = pipeline.analyze_song_text(text)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except pipeline.AnalyzeError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"❌ 分析失败: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()