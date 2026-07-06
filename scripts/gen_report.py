#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""CI 模板報告產生器（無 Claude，純統計）。

從 trends.json 產出結構合法的每日報告：熱度排名、狀態、來源連結齊全。
本機執行 /daily 會以 Claude 敘事版覆寫（generated: "template" → "claude"，
語意歸類 unassigned_hot、重寫 what/why_hot 敘事與 tldr）。

  gen_report.py --date 2026-07-06 [--out PATH] [--force]

已存在非模板（Claude 版）報告時跳過不覆寫，除非 --force。
"""
import argparse
import datetime
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMS = ["ai", "software", "devops", "uiux"]
PREFIX = {"ai": "ai", "software": "sw", "devops": "do", "uiux": "ux"}
DOM_ZH = {"ai": "AI", "software": "前後端", "devops": "DevOps", "uiux": "UI/UX"}
STATUS_ZH = {"new": "新爆發", "rising": "上升", "ongoing": "持續", "fading": "退燒"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", help="輸出路徑（預設 site/data/reports/<date>.json）")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.out or os.path.join(ROOT, "site", "data", "reports", f"{args.date}.json")
    if os.path.exists(out) and not args.force:
        with open(out, encoding="utf-8") as f:
            existing = json.load(f)
        if existing.get("generated") != "template":
            print(f"gen_report: {args.date} 已有非模板報告（Claude 版），跳過")
            return 0

    trends_path = os.path.join(ROOT, "data", "raw", args.date, "trends.json")
    if not os.path.exists(trends_path):
        raise SystemExit(f"gen_report: 找不到 {trends_path}，先跑 fetch_all + analyze")
    with open(trends_path, encoding="utf-8") as f:
        trends = json.load(f)

    sections: dict[str, list] = {d: [] for d in DOMS}
    id_by_slug: dict[str, str] = {}
    for tp in trends["topics"]:
        d = tp.get("domain") or "software"
        if d not in sections or len(sections[d]) >= 4 or tp["mentions"] == 0:
            continue
        tid = f"{PREFIX[d]}-{len(sections[d]) + 1}"
        id_by_slug[tp["slug"]] = tid
        items = tp["top_items"]
        titles = "；".join(f"「{i['title'][:60]}」" for i in items[:3])
        sections[d].append({
            "id": tid,
            "title": tp["display"],
            "status": tp["status"],
            "heat_today": tp["heat_today"],
            "heat_trend": tp["heat_trend"],
            "what": f"當日 {tp['mentions']} 則相關討論：{titles}。",
            "why_hot": f"熱度 {tp['heat_today']:.0f}、狀態「{STATUS_ZH.get(tp['status'], tp['status'])}」"
                       f"——由管線統計自動判定。",
            "sources": [
                {"label": f"{i['source']}：{i['title'][:42]}",
                 "url": i.get("discussion_url") or i["url"]}
                for i in items[:4]
            ],
        })

    ranked = sorted(
        (tp for tp in trends["topics"] if tp["slug"] in id_by_slug),
        key=lambda t: -t["heat_today"])
    tldr = [{
        "title": f"[{DOM_ZH.get(tp['domain'], tp['domain'])}] {tp['display']}",
        "text": f"熱度 {tp['heat_today']:.0f}（{STATUS_ZH.get(tp['status'], tp['status'])}），"
                f"共 {tp['mentions']} 則討論；重點連結見對應段落。",
        "deadline": None,
        "topic_ref": id_by_slug[tp["slug"]],
    } for tp in ranked[:4]]

    radar = [{
        "title": u["title"][:70],
        "note": f"{u['source']} · 熱度 {u['heat']:.0f}（未歸戶）",
        "url": u.get("discussion_url") or u["url"],
    } for u in trends.get("unassigned_hot", [])[:6]]

    dq = [{"source": k, "note": f"來源狀態：{v}"}
          for k, v in trends.get("source_health", {}).items() if v != "ok"]
    if not trends.get("committed"):
        dq.append({"source": "回溯模式",
                   "note": "本期為事後回溯：僅 HN 歷史資料（分數為現在累計值），"
                           "Reddit/GitHub 無歷史排行；未寫入趨勢 ledger"})
    dq.append({"source": "報告產生方式",
               "note": "CI 模板版（純統計）；本機 /daily 可升級為 Claude 敘事版"})

    y, m, d = map(int, args.date.split("-"))
    report = {
        "date": args.date,
        "weekday": "一二三四五六日"[datetime.date(y, m, d).weekday()],
        "generated": "template",
        "tldr": tldr,
        "sections": sections,
        "radar": radar,
        "data_quality": dq,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write("\n")
    n = sum(len(v) for v in sections.values())
    print(f"gen_report: {args.date} 模板報告完成（{n} topics / {len(tldr)} tldr）-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
