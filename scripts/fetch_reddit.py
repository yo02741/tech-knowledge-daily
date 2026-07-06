#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""抓 Reddit 技術版。主路徑 top.json，403/429/5xx 時 fallback 到 .rss。

每日模式（每個 sub 一檔 reddit-<sub>.json）：
  fetch_reddit.py --config config/sources.json --outdir data/raw/2026-07-06/
深挖模式：
  fetch_reddit.py --query "fable 5" --days 7 --out -
exit code：0 全成功 / 2 部分失敗或降級 / 1 全部失敗
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = "tech-knowledge-daily/1.0 (personal trend tracker; contact a0922335447@gmail.com)"
ATOM = "{http://www.w3.org/2005/Atom}"


def get(url: str, retries: int = 2, timeout: int = 15) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                # Reddit 429 退避要夠長，普通錯誤短退避即可
                is_429 = isinstance(e, urllib.error.HTTPError) and e.code == 429
                time.sleep(15 * (attempt + 1) if is_429 else 2 * (attempt + 1))
    raise RuntimeError(f"GET {url}: {last_err}")


def norm_json_post(post: dict, sub: str) -> dict | None:
    d = post.get("data", {})
    if not d.get("title") or d.get("stickied"):
        return None
    return {
        "id": f"r-{d.get('id', '')}",
        "title": d["title"],
        "url": d.get("url") or f"https://www.reddit.com{d.get('permalink', '')}",
        "points": d.get("score") or 0,
        "num_comments": d.get("num_comments") or 0,
        "created_at": datetime.fromtimestamp(
            d.get("created_utc", 0), tz=timezone.utc
        ).isoformat(timespec="seconds"),
        "discussion_url": f"https://www.reddit.com{d.get('permalink', '')}",
    }


def fetch_sub_json(sub: str, t: str = "day", limit: int = 25) -> list[dict]:
    # 2026-07 實測：無 OAuth 的 .json 一律 403（www 與 old 皆然），單次嘗試即可，
    # 失敗立即 fallback RSS。留著這條路徑是為了萬一日後解封或改走 OAuth。
    raw = get(f"https://www.reddit.com/r/{sub}/top.json?t={t}&limit={limit}", retries=0)
    posts = json.loads(raw.decode("utf-8")).get("data", {}).get("children", [])
    return [it for p in posts if (it := norm_json_post(p, sub))]


def fetch_sub_rss(sub: str, t: str = "day") -> list[dict]:
    raw = get(f"https://www.reddit.com/r/{sub}/top.rss?t={t}")
    return parse_rss(raw, "r-rss")


def fetch_one_sub(sub: str, force_fallback: bool) -> tuple[list[dict], bool]:
    """回傳 (items, degraded)。兩路徑都失敗會 raise。"""
    if not force_fallback:
        try:
            return fetch_sub_json(sub), False
        except RuntimeError as e:
            print(f"fetch_reddit: r/{sub} json 失敗（{e}），改走 RSS", file=sys.stderr)
    return fetch_sub_rss(sub), True


def write_payload(path: str, sub: str, items: list[dict], ok: bool, degraded: bool) -> None:
    payload = {
        "source": "reddit",
        "sub": sub,
        "fetched_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "ok": ok,
        "degraded": degraded,
        "items": items,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if path == "-":
        print(text)
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")


def daily_mode(args: argparse.Namespace) -> int:
    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    mode = cfg.get("reddit_mode", "json")
    if mode == "off":
        print("fetch_reddit: reddit_mode=off，跳過", file=sys.stderr)
        return 0
    subs = cfg.get("subreddits", [])
    expected_rss = args.force_fallback or mode == "rss"
    failed: list[str] = []
    n_degraded = 0

    def try_sub(sub: str) -> bool:
        nonlocal n_degraded
        out = f"{args.outdir.rstrip('/')}/reddit-{sub}.json"
        try:
            items, degraded = fetch_one_sub(sub, expected_rss)
            write_payload(out, sub, items, True, degraded)
            # rss 是設定好的常態模式時不算「降級」（exit 0）；payload 的
            # degraded 旗標照實寫，讓 trend_state 知道分數是估值
            n_degraded += degraded and not expected_rss
            print(f"fetch_reddit: r/{sub} {len(items)} items"
                  f"{'（RSS 降級）' if degraded else ''} -> {out}", file=sys.stderr)
            return True
        except (RuntimeError, ET.ParseError) as e:
            write_payload(out, sub, [], False, True)
            print(f"fetch_reddit: r/{sub} 失敗：{e}", file=sys.stderr)
            return False

    for i, sub in enumerate(subs):
        if i:
            time.sleep(8)  # RSS 間隔太短會 429（實測 8s 穩定）
        if not try_sub(sub):
            failed.append(sub)

    # 429 常是分鐘級限流，冷卻後補一輪
    if failed and len(failed) < len(subs):
        print(f"fetch_reddit: 冷卻 45s 後重試 {len(failed)} 個 sub", file=sys.stderr)
        time.sleep(45)
        still_failed = []
        for i, sub in enumerate(failed):
            if i:
                time.sleep(8)
            if not try_sub(sub):
                still_failed.append(sub)
        failed = still_failed

    if len(failed) == len(subs):
        return 1
    return 2 if (failed or n_degraded) else 0


def parse_rss(raw: bytes, id_prefix: str) -> list[dict]:
    root = ET.fromstring(raw)
    items = []
    for entry in root.findall(f"{ATOM}entry"):
        title = entry.findtext(f"{ATOM}title") or ""
        link_el = entry.find(f"{ATOM}link")
        link = link_el.get("href") if link_el is not None else ""
        entry_id = (entry.findtext(f"{ATOM}id") or link).rsplit("/", 2)[-2:]
        if not title:
            continue
        items.append({
            "id": f"{id_prefix}-{'-'.join(entry_id)}",
            "title": title,
            "url": link,
            "points": None,  # RSS 沒有分數，交由 trend_state 估值
            "num_comments": None,
            "created_at": entry.findtext(f"{ATOM}updated") or "",
            "discussion_url": link,
        })
    return items


def query_mode(args: argparse.Namespace) -> int:
    t = "week" if args.days > 1 else "day"
    q = urllib.parse.quote(args.query)
    try:
        raw = get(f"https://www.reddit.com/search.json?q={q}&t={t}&sort=top&limit=50",
                  retries=0)
        posts = json.loads(raw.decode("utf-8")).get("data", {}).get("children", [])
        items = [it for p in posts if (it := norm_json_post(p, ""))]
        write_payload(args.out, "_search", items, True, False)
        return 0
    except RuntimeError:
        pass  # json 路徑 403 是常態，改走 RSS
    try:
        raw = get(f"https://www.reddit.com/search.rss?q={q}&t={t}&sort=top&limit=50")
        items = parse_rss(raw, "r-rss")
        write_payload(args.out, "_search", items, True, True)
        return 0
    except (RuntimeError, ET.ParseError) as e:
        print(f"fetch_reddit: 全站搜尋失敗：{e}", file=sys.stderr)
        write_payload(args.out, "_search", [], False, True)
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="每日模式：sources.json 路徑")
    ap.add_argument("--outdir", help="每日模式：輸出目錄")
    ap.add_argument("--query", help="深挖模式：關鍵字")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--out", default="-", help="深挖模式輸出，- 表示 stdout")
    ap.add_argument("--force-fallback", action="store_true", help="強制走 RSS（測試用）")
    args = ap.parse_args()

    if args.query:
        return query_mode(args)
    if not (args.config and args.outdir):
        ap.error("每日模式需要 --config 與 --outdir")
    return daily_mode(args)


if __name__ == "__main__":
    sys.exit(main())
