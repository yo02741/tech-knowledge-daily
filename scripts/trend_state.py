#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""趨勢狀態機：熱度計算 + topic ledger（data/state/topics.json）。

子命令：
  analyze --date 2026-07-06 [--commit]   計算當日趨勢 → data/raw/<date>/trends.json；
                                          --commit 才寫回 ledger（深挖/重算用乾跑）
  add-topic <slug> --display "..." --domain ai --alias "a" [--alias "b"] [--note "..."]
  add-alias <slug> "<新別名>"
  cloud --date 2026-07-06 [--days 14] [--out site/data/trend-cloud.json]
                                          近 N 天熱度加總 → 文字雲資料
  selftest                                內建假資料驗證狀態轉移與 cloud 權重

狀態機：new(首見) / rising(≥1.5×前3日均且mentions≥2) / ongoing / fading(<0.5×或
消失但5日內出現過)；>14天未見 prune。數字全由本 script 算，agent 只做語意歸類。
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER_PATH = os.path.join(ROOT, "data", "state", "topics.json")
CONFIG_PATH = os.path.join(ROOT, "config", "sources.json")

RISING_RATIO = 1.5
FADING_RATIO = 0.5
FADING_GRACE_DAYS = 5
PRUNE_DAYS = 14
DEGRADED_DISCOUNT = 0.5


def load_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def date_diff_days(a: str, b: str) -> int:
    """a - b 的天數（YYYY-MM-DD）。"""
    from datetime import date
    ya, ma, da = map(int, a.split("-"))
    yb, mb, db = map(int, b.split("-"))
    return (date(ya, ma, da) - date(yb, mb, db)).days


def item_domain(title: str, domains: dict) -> tuple[str, float]:
    """依關鍵詞判 domain；優先序照 config 順序（ai > software > devops）。"""
    low = f" {title.lower()} "
    for name, cfg in domains.items():
        for kw in cfg["keywords"]:
            if kw in low:
                return name, cfg["weight"]
    return "", 1.0


def load_day_items(raw_dir: str, source_scale: dict | None = None) -> tuple[list[dict], dict]:
    """讀當日所有 raw 檔，回傳 (items, source_health)。

    null 分數（RSS 無分數）的估值：有已知分數用中位數；全 null（RSS 常態）
    用排名衰減 200/rank —— top.rss 本身按當日熱度排序，rank 是唯一可用訊號。
    估值一律打 DEGRADED_DISCOUNT 折。source_scale 校準跨來源量級差
    （GitHub stars-today 天生比 HN points 大數倍）。"""
    items, health = [], {}
    source_scale = source_scale or {}
    for path in sorted(glob.glob(os.path.join(raw_dir, "*.json"))):
        name = os.path.basename(path).removesuffix(".json")
        if name == "trends":
            continue
        d = load_json(path)
        if not d or not d.get("ok"):
            health[name] = "failed"
            continue
        degraded = d.get("degraded", False)
        health[name] = "fallback-rss" if degraded else "ok"
        raw_items = d.get("items", [])
        known = [i["points"] for i in raw_items if i.get("points") is not None]
        median_est = statistics.median(known) if known else None
        scale = source_scale.get(d.get("source", name), 1.0)
        for rank, it in enumerate(raw_items, start=1):
            points = it.get("points")
            comments = it.get("num_comments") or 0
            estimated = points is None
            if estimated:
                points = median_est if median_est is not None else 200 / rank
            src = f"r/{d['sub']}" if d.get("source") == "reddit" else d.get("source", name)
            items.append({
                "title": it.get("title", ""),
                "url": it.get("url", ""),
                "discussion_url": it.get("discussion_url", ""),
                "source": src,
                "base_heat": (points + 0.5 * comments) * scale
                             * (DEGRADED_DISCOUNT if estimated else 1.0),
            })
    return items, health


def match_topic(title: str, topics: dict) -> str | None:
    """alias 用 word-boundary 比對——純子字串會誤中（如 'orm' 中 'performance'）。
    允許尾端複數 s（orm→ORMs、claude code skill→skills）。"""
    low = title.lower()
    for slug, t in topics.items():
        for alias in t.get("aliases", []):
            if re.search(rf"\b{re.escape(alias.lower())}s?\b", low):
                return slug
    return None


def recent_avg(history: list[dict], today: str, days: int = 3) -> float:
    """今天以前、最近 N 個日曆日內的平均 heat（沒出現的天不計零——
    用出現日平均，避免抓取失誤日把基準拉低）。"""
    vals = [h["heat"] for h in history
            if h["date"] != today and 0 < date_diff_days(today, h["date"]) <= days]
    return sum(vals) / len(vals) if vals else 0.0


def compute_status(topic: dict, today: str, heat_today: float, mentions: int) -> str:
    if topic.get("first_seen") == today:
        return "new"
    avg = recent_avg(topic.get("history", []), today)
    if mentions == 0:
        return "fading"
    if avg <= 0:
        # 前 3 日無資料（超過 3 天沒出現後回歸）→ 視為再爆發
        return "rising" if mentions >= 2 else "ongoing"
    if heat_today >= RISING_RATIO * avg and mentions >= 2:
        return "rising"
    if heat_today < FADING_RATIO * avg:
        return "fading"
    return "ongoing"


def analyze(date: str, commit: bool, raw_root: str | None = None,
            ledger_path: str | None = None, config_path: str | None = None) -> dict:
    raw_dir = os.path.join(raw_root or os.path.join(ROOT, "data", "raw"), date)
    ledger_path = ledger_path or LEDGER_PATH
    cfg = load_json(config_path or CONFIG_PATH)
    ledger = load_json(ledger_path, {"last_run": "", "topics": {}})
    topics = ledger["topics"]

    if not os.path.isdir(raw_dir):
        raise SystemExit(f"trend_state: 找不到 raw 目錄 {raw_dir}，先跑 fetch_all.sh")

    items, health = load_day_items(raw_dir, cfg.get("source_scale", {}))

    # 歸戶：ledger alias 命中 → topic；否則只判 domain 權重
    assigned: dict[str, list[dict]] = {}
    unassigned: list[dict] = []
    for it in items:
        domain, weight = item_domain(it["title"], cfg["domains"])
        slug = match_topic(it["title"], topics)
        if slug:
            t_domain = topics[slug].get("domain", domain)
            w = cfg["domains"].get(t_domain, {}).get("weight", weight)
            it["heat"] = round(it["base_heat"] * w, 1)
            assigned.setdefault(slug, []).append(it)
        else:
            it["heat"] = round(it["base_heat"] * weight, 1)
            it["domain"] = domain
            unassigned.append(it)

    # 每個 topic 的當日彙總 + 狀態
    out_topics = []
    for slug, t in topics.items():
        day_items = assigned.get(slug, [])
        heat_today = round(sum(i["heat"] for i in day_items), 1)
        mentions = len(day_items)
        if mentions == 0 and date_diff_days(date, t.get("last_seen", t["first_seen"])) > FADING_GRACE_DAYS:
            continue  # 淡出寬限期外且今天沒出現 → 不進報告（等 prune）
        status = compute_status(t, date, heat_today, mentions)
        hist = [h for h in t.get("history", []) if h["date"] != date]
        trend = [h["heat"] for h in hist[-6:]] + [heat_today]
        out_topics.append({
            "slug": slug,
            "display": t.get("display", slug),
            "domain": t.get("domain", ""),
            "status": status,
            "heat_today": heat_today,
            "mentions": mentions,
            "heat_trend": trend,
            "note": t.get("note", ""),
            "top_items": sorted(day_items, key=lambda i: -i["heat"])[:5],
        })
        if commit:
            if mentions > 0:
                t["last_seen"] = date
            t["status"] = status
            t["history"] = hist + [{"date": date, "heat": heat_today, "mentions": mentions}]
            t["history"] = t["history"][-30:]

    if commit:
        for slug in [s for s, t in topics.items()
                     if date_diff_days(date, t.get("last_seen", t["first_seen"])) > PRUNE_DAYS]:
            del topics[slug]
        ledger["last_run"] = date
        save_json(ledger_path, ledger)

    min_heat = cfg.get("unassigned_min_heat", 60)
    max_items = cfg.get("unassigned_max_items", 15)
    per_family = cfg.get("unassigned_max_per_source", 6)
    # 每來源家族上限：RSS 估值天花板低，沒有上限的話 Reddit 訊號會被
    # GitHub/HN 的真實分數整批擠出榜
    family_count: dict[str, int] = {}
    unassigned_hot = []
    for it in sorted([i for i in unassigned if i["heat"] >= min_heat],
                     key=lambda i: -i["heat"]):
        fam = "reddit" if it["source"].startswith("r/") else it["source"]
        if family_count.get(fam, 0) >= per_family:
            continue
        family_count[fam] = family_count.get(fam, 0) + 1
        unassigned_hot.append(it)
        if len(unassigned_hot) >= max_items:
            break

    trends = {
        "date": date,
        "topics": sorted(out_topics, key=lambda t: -t["heat_today"]),
        "unassigned_hot": [
            {k: it[k] for k in ("title", "url", "discussion_url", "source", "heat", "domain")}
            for it in unassigned_hot],
        "source_health": health,
        "committed": commit,
    }
    save_json(os.path.join(raw_dir, "trends.json"), trends)
    return trends


def build_cloud(date: str, days: int, ledger_path: str | None = None) -> dict:
    """近 days 天各 topic 熱度加總（文字雲權重）。0 權重（窗內無熱度）排除。"""
    ledger = load_json(ledger_path or LEDGER_PATH, {"last_run": "", "topics": {}})
    items = []
    for slug, t in ledger["topics"].items():
        weight = sum(h["heat"] for h in t.get("history", [])
                     if 0 <= date_diff_days(date, h["date"]) < days)
        if weight <= 0:
            continue
        aliases = t.get("aliases", [])
        items.append({
            "slug": slug,
            "display": t.get("display", slug),
            # 文字雲用短標籤（最短別名）——長標題排不成緊密的雲
            "label": min(aliases, key=len) if aliases else t.get("display", slug),
            "weight": round(weight, 1),
            "status": t.get("status", "ongoing"),
            "domain": t.get("domain", ""),
            "last_seen": t.get("last_seen", ""),
        })
    items.sort(key=lambda i: -i["weight"])
    return {"date": date, "window_days": days, "items": items}


def cmd_add_topic(args) -> None:
    ledger = load_json(LEDGER_PATH, {"last_run": "", "topics": {}})
    if args.slug in ledger["topics"]:
        raise SystemExit(f"topic {args.slug} 已存在，用 add-alias 補別名")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.slug):
        raise SystemExit("slug 只能用小寫英數與連字號")
    today = args.date
    ledger["topics"][args.slug] = {
        "display": args.display,
        "aliases": args.alias,
        "domain": args.domain,
        "first_seen": today,
        "last_seen": today,
        "history": [],
        "status": "new",
        "note": args.note or "",
    }
    save_json(LEDGER_PATH, ledger)
    print(f"add-topic: {args.slug}（{len(args.alias)} aliases）")


def cmd_add_alias(args) -> None:
    ledger = load_json(LEDGER_PATH, {"last_run": "", "topics": {}})
    t = ledger["topics"].get(args.slug)
    if not t:
        raise SystemExit(f"找不到 topic {args.slug}")
    if args.new_alias.lower() not in [a.lower() for a in t["aliases"]]:
        t["aliases"].append(args.new_alias)
        save_json(LEDGER_PATH, ledger)
    print(f"add-alias: {args.slug} <- {args.new_alias!r}")


def selftest() -> int:
    """三天假資料驗證：day1 new → day2 rising → day3 fading，加 prune 與估值。"""
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix="trend-selftest-")
    try:
        cfg_path = os.path.join(tmp, "sources.json")
        ledger_path = os.path.join(tmp, "topics.json")
        raw_root = os.path.join(tmp, "raw")
        save_json(cfg_path, {
            "unassigned_min_heat": 60, "unassigned_max_items": 15,
            "domains": {"ai": {"weight": 3, "keywords": ["llm"]},
                        "software": {"weight": 2, "keywords": ["rust"]}}})
        save_json(ledger_path, {"last_run": "", "topics": {
            "foo-launch": {"display": "Foo 發表", "aliases": ["foo 2.0"], "domain": "ai",
                           "first_seen": "2026-01-01", "last_seen": "2026-01-01",
                           "history": [], "status": "new", "note": ""},
            "stale-topic": {"display": "老議題", "aliases": ["zzz"], "domain": "ai",
                            "first_seen": "2025-12-01", "last_seen": "2025-12-10",
                            "history": [], "status": "ongoing", "note": ""}}})

        def day(date, foo_points, extra=None):
            d = os.path.join(raw_root, date)
            os.makedirs(d, exist_ok=True)
            items = [{"title": f"Foo 2.0 released with LLM support {i}", "url": "u",
                      "points": p, "num_comments": 10, "discussion_url": "d"}
                     for i, p in enumerate(foo_points)]
            save_json(os.path.join(d, "hn.json"),
                      {"source": "hn", "ok": True, "items": items + (extra or [])})

        run = lambda date: analyze(date, commit=True, raw_root=raw_root,
                                   ledger_path=ledger_path, config_path=cfg_path)

        # day1：首見日 first_seen==date → new；順便測 unassigned + RSS 估值
        save_json(ledger_path, load_json(ledger_path))
        ledger = load_json(ledger_path)
        ledger["topics"]["foo-launch"]["first_seen"] = "2026-01-01"
        save_json(ledger_path, ledger)
        day("2026-01-01", [30, 30],
            extra=[{"title": "Hot Rust thing", "url": "u", "points": 100,
                    "num_comments": 0, "discussion_url": "d"},
                   {"title": "estimated rust item", "url": "u", "points": None,
                    "num_comments": None, "discussion_url": "d"}])
        t1 = run("2026-01-01")
        foo = next(t for t in t1["topics"] if t["slug"] == "foo-launch")
        assert foo["status"] == "new", foo
        assert foo["heat_today"] == (35 * 3) * 2, foo  # (30+5)*w3 ×2則
        hot_titles = [u["title"] for u in t1["unassigned_hot"]]
        assert "Hot Rust thing" in hot_titles, t1["unassigned_hot"]
        # null 分數估值：中位數 30 × 0.5 折 × w2 = 30，低於門檻 60 → 不得進清單
        assert "estimated rust item" not in hot_titles, t1["unassigned_hot"]

        # day2：熱度 3 倍 → rising
        day("2026-01-02", [90, 90, 90])
        t2 = run("2026-01-02")
        foo = next(t for t in t2["topics"] if t["slug"] == "foo-launch")
        assert foo["status"] == "rising", foo
        assert foo["heat_trend"][-2:] == [210.0, foo["heat_today"]], foo

        # day3：完全消失 → fading（寬限期內）
        day("2026-01-03", [])
        t3 = run("2026-01-03")
        foo = next(t for t in t3["topics"] if t["slug"] == "foo-launch")
        assert foo["status"] == "fading" and foo["heat_today"] == 0, foo

        # prune：stale-topic last_seen 2025-12-10，距 2026-01-03 超過 14 天 → 已被移除
        ledger = load_json(ledger_path)
        assert "stale-topic" not in ledger["topics"], ledger["topics"].keys()
        assert ledger["topics"]["foo-launch"]["history"][-1]["date"] == "2026-01-03"

        # 乾跑不污染：再 analyze 一次不 commit，ledger 不變
        before = json.dumps(load_json(ledger_path), sort_keys=True)
        analyze("2026-01-03", commit=False, raw_root=raw_root,
                ledger_path=ledger_path, config_path=cfg_path)
        assert json.dumps(load_json(ledger_path), sort_keys=True) == before

        # cloud：14 天窗加總 day1(210)+day2(855)+day3(0)；2 天窗只含 day2、day3
        cloud = build_cloud("2026-01-03", 14, ledger_path=ledger_path)
        foo_c = next(i for i in cloud["items"] if i["slug"] == "foo-launch")
        assert foo_c["weight"] == 210 + 855, foo_c
        cloud2 = build_cloud("2026-01-03", 2, ledger_path=ledger_path)
        foo_c2 = next(i for i in cloud2["items"] if i["slug"] == "foo-launch")
        assert foo_c2["weight"] == 855, foo_c2  # day1 在 2 天窗外、day3 為 0
        # 窗內全 0 → 不進雲
        cloud3 = build_cloud("2026-01-04", 1, ledger_path=ledger_path)
        assert all(i["slug"] != "foo-launch" for i in cloud3["items"]), cloud3

        print("selftest: 全部通過（new→rising→fading、prune、估值折價、乾跑不污染、cloud 權重）")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("analyze")
    p.add_argument("--date", required=True)
    p.add_argument("--commit", action="store_true")

    p = sub.add_parser("add-topic")
    p.add_argument("slug")
    p.add_argument("--display", required=True)
    p.add_argument("--domain", required=True, choices=["ai", "software", "devops", "uiux"])
    p.add_argument("--alias", action="append", required=True)
    p.add_argument("--date", required=True, help="首見日（通常是今天）")
    p.add_argument("--note", default="")

    p = sub.add_parser("add-alias")
    p.add_argument("slug")
    p.add_argument("new_alias")

    p = sub.add_parser("cloud")
    p.add_argument("--date", required=True)
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--out", default=os.path.join(ROOT, "site", "data", "trend-cloud.json"))

    sub.add_parser("selftest")

    args = ap.parse_args()
    if args.cmd == "analyze":
        trends = analyze(args.date, args.commit)
        n_hot = len(trends["unassigned_hot"])
        print(f"analyze: {len(trends['topics'])} topics, {n_hot} unassigned_hot"
              f"{'（已寫回 ledger）' if args.commit else '（乾跑）'}")
    elif args.cmd == "add-topic":
        cmd_add_topic(args)
    elif args.cmd == "add-alias":
        cmd_add_alias(args)
    elif args.cmd == "cloud":
        cloud = build_cloud(args.date, args.days)
        save_json(args.out, cloud)
        print(f"cloud: {len(cloud['items'])} topics（{args.days} 天窗）-> {args.out}")
    elif args.cmd == "selftest":
        return selftest()
    return 0


if __name__ == "__main__":
    sys.exit(main())
