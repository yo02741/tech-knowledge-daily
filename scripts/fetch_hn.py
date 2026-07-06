#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""抓 Hacker News（Algolia API，免 auth）。

每日模式：front_page + 近 24h 高分 story 合併去重
  fetch_hn.py --out data/raw/2026-07-06/hn.json
回溯模式：撈指定日期（UTC 窗）的高分 story——Algolia 可回查歷史，
分數是「現在的累計值」而非當日快照，回溯報告會註明
  fetch_hn.py --for-date 2026-07-05 --out data/raw/2026-07-05/hn.json
深挖模式：關鍵字搜近 N 天
  fetch_hn.py --query "fable 5" --days 7 --out -
"""
import calendar
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://hn.algolia.com/api/v1"
UA = "tech-knowledge-daily/1.0 (personal trend tracker)"


def get_json(url: str, retries: int = 2, timeout: int = 15) -> dict:
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 — 統一重試
            last_err = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries + 1} tries: {last_err}")


def normalize(hit: dict) -> dict:
    story_id = hit.get("objectID", "")
    return {
        "id": f"hn-{story_id}",
        "title": hit.get("title") or "",
        "url": hit.get("url") or f"https://news.ycombinator.com/item?id={story_id}",
        "points": hit.get("points") or 0,
        "num_comments": hit.get("num_comments") or 0,
        "created_at": hit.get("created_at") or "",
        "discussion_url": f"https://news.ycombinator.com/item?id={story_id}",
    }


def fetch_daily(front_limit: int, min_points: int, recent_limit: int) -> list[dict]:
    cutoff = int(time.time()) - 24 * 3600
    front = get_json(f"{API}/search?tags=front_page&hitsPerPage={front_limit}")
    recent = get_json(
        f"{API}/search_by_date?tags=story"
        f"&numericFilters=points>{min_points},created_at_i>{cutoff}"
        f"&hitsPerPage={recent_limit}"
    )
    seen: dict[str, dict] = {}
    for hit in front.get("hits", []) + recent.get("hits", []):
        item = normalize(hit)
        if item["title"] and item["id"] not in seen:
            seen[item["id"]] = item
    return list(seen.values())


def fetch_for_date(date: str, min_points: int) -> list[dict]:
    y, m, d = map(int, date.split("-"))
    start = calendar.timegm((y, m, d, 0, 0, 0))
    end = start + 24 * 3600
    # search endpoint 對這組合回 400，search_by_date 才吃日期窗（實測）
    data = get_json(
        f"{API}/search_by_date?tags=story"
        f"&numericFilters=created_at_i>{start - 1},created_at_i<{end},points>{min_points}"
        f"&hitsPerPage=100"
    )
    return [normalize(h) for h in data.get("hits", []) if h.get("title")]


def fetch_query(query: str, days: int) -> list[dict]:
    cutoff = int(time.time()) - days * 24 * 3600
    q = urllib.parse.quote(query)
    data = get_json(
        f"{API}/search?query={q}&tags=story"
        f"&numericFilters=created_at_i>{cutoff}&hitsPerPage=50"
    )
    return [normalize(h) for h in data.get("hits", []) if h.get("title")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="輸出路徑，- 表示 stdout")
    ap.add_argument("--query", help="深挖模式：關鍵字")
    ap.add_argument("--for-date", help="回溯模式：撈該 UTC 日的高分 story")
    ap.add_argument("--days", type=int, default=7, help="深挖模式回看天數")
    ap.add_argument("--front-limit", type=int, default=30)
    ap.add_argument("--min-points", type=int, default=50)
    ap.add_argument("--recent-limit", type=int, default=50)
    args = ap.parse_args()

    try:
        if args.query:
            items = fetch_query(args.query, args.days)
        elif args.for_date:
            items = fetch_for_date(args.for_date, args.min_points // 2)
        else:
            items = fetch_daily(args.front_limit, args.min_points, args.recent_limit)
        ok = True
    except RuntimeError as e:
        print(f"fetch_hn: {e}", file=sys.stderr)
        items, ok = [], False

    payload = {
        "source": "hn",
        "fetched_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "ok": ok,
        "items": items,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if args.out == "-":
        print(text)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"fetch_hn: {len(items)} items -> {args.out}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
