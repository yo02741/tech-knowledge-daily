#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""抓 GitHub Trending（無官方 API，解析 HTML；結構多年穩定：article.Box-row）。

每日模式（config 的 github.languages 每個語言一輪，合併去重）：
  fetch_github.py --config config/sources.json --out data/raw/2026-07-06/github.json
單獨測試：
  fetch_github.py --out -
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

UA = "tech-knowledge-daily/1.0 (personal trend tracker)"

RE_REPO = re.compile(r'<h2[^>]*>.*?href="/([^/"]+/[^/"]+)"', re.S)
RE_STARS_TODAY = re.compile(r"([\d,]+)\s+stars?\s+today")
RE_DESC = re.compile(r'<p class="col-9[^"]*"[^>]*>(.*?)</p>', re.S)
RE_LANG = re.compile(r'itemprop="programmingLanguage">([^<]+)')
RE_TOTAL_STARS = re.compile(r'href="/[^"]+/stargazers"[^>]*>\s*<svg.*?</svg>\s*([\d,]+)', re.S)


def get(url: str, retries: int = 2, timeout: int = 20) -> str:
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last_err}")


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def parse_trending(page: str) -> list[dict]:
    items = []
    for block in page.split('<article class="Box-row"')[1:]:
        m = RE_REPO.search(block)
        if not m:
            continue
        repo = m.group(1)
        stars_today = RE_STARS_TODAY.search(block)
        desc_m = RE_DESC.search(block)
        lang_m = RE_LANG.search(block)
        desc = strip_tags(desc_m.group(1)) if desc_m else ""
        items.append({
            "id": f"gh-{repo}",
            "title": f"{repo}" + (f" — {desc}" if desc else ""),
            "url": f"https://github.com/{repo}",
            "points": int(stars_today.group(1).replace(",", "")) if stars_today else 0,
            "num_comments": 0,
            "created_at": "",
            "discussion_url": f"https://github.com/{repo}",
            "language": lang_m.group(1) if lang_m else "",
        })
    return items


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="sources.json（讀 github.languages / since）")
    ap.add_argument("--out", required=True, help="輸出路徑，- 表示 stdout")
    args = ap.parse_args()

    languages, since = [""], "daily"
    if args.config:
        with open(args.config, encoding="utf-8") as f:
            gh_cfg = json.load(f).get("github", {})
        languages = gh_cfg.get("languages", [""])
        since = gh_cfg.get("since", "daily")

    seen: dict[str, dict] = {}
    ok = False
    for i, lang in enumerate(languages):
        if i:
            time.sleep(3)
        url = f"https://github.com/trending/{lang}?since={since}" if lang \
            else f"https://github.com/trending?since={since}"
        try:
            for item in parse_trending(get(url)):
                seen.setdefault(item["id"], item)
            ok = True  # 任一語言頁成功即算成功
        except RuntimeError as e:
            print(f"fetch_github: {url} 失敗：{e}", file=sys.stderr)

    payload = {
        "source": "github",
        "fetched_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "ok": ok,
        "items": list(seen.values()),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if args.out == "-":
        print(text)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"fetch_github: {len(seen)} repos -> {args.out}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
