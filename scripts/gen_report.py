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
  gen_report.py --date 2026-07-06 --inject-tech-intro   # 只補既有報告缺的 tech_intro

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
CARD_DOMAINS = ["ai", "frontend", "backend", "uiux", "devops"]  # 每日一技術：domain 輪轉順序


def pick_tech_card(date_str: str) -> dict:
    """每日一技術簡介：由日期確定性選卡（同一天永遠同一張，題庫輪完前不重複）。

    days = 距 1970-01-01 天數；domain = CARD_DOMAINS[days % 5]；
    該 domain 的卡按 tech-cards.json 檔案內順序取第 (days // 5) % 張。
    """
    path = os.path.join(ROOT, "site", "data", "tech-cards.json")
    with open(path, encoding="utf-8") as f:
        cards = json.load(f)
    y, m, d = map(int, date_str.split("-"))
    days = (datetime.date(y, m, d) - datetime.date(1970, 1, 1)).days
    domain = CARD_DOMAINS[days % len(CARD_DOMAINS)]
    pool = [c for c in cards if c.get("domain") == domain]
    if not pool:
        raise SystemExit(f"gen_report: tech-cards.json 沒有 domain={domain} 的卡")
    return pool[(days // len(CARD_DOMAINS)) % len(pool)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", help="輸出路徑（預設 site/data/reports/<date>.json）")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--inject-tech-intro", action="store_true",
                    help="只對既有報告補缺的 tech_intro（不論 template/claude 版），不做其他事")
    args = ap.parse_args()

    out = args.out or os.path.join(ROOT, "site", "data", "reports", f"{args.date}.json")

    if args.inject_tech_intro:
        if not os.path.exists(out):
            raise SystemExit(f"gen_report: 找不到 {out}，--inject-tech-intro 只補既有報告")
        with open(out, encoding="utf-8") as f:
            report = json.load(f)
        if "tech_intro" in report:
            print(f"gen_report: {args.date} 已有 tech_intro"
                  f"（{report['tech_intro'].get('id')}），不動")
            return 0
        card = pick_tech_card(args.date)
        report["tech_intro"] = card
        with open(out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"gen_report: {args.date} 補入 tech_intro（{card['domain']}/{card['id']}）-> {out}")
        return 0

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

    # ---- 選題三分法：完整卡 / 追蹤條 / 退場 ----
    # 版面要「賺」：只有新爆發、上升、或熱度顯著變化（±30%）的話題拿完整卡；
    # 持平的 ongoing 壓縮成「持續追蹤」一行；退燒且低熱度直接退出正文。
    # 這是「每天有新知感」的核心規則——舊聞不再天天佔滿版面。
    def day_delta(tp) -> float | None:
        trend = tp.get("heat_trend") or []
        if len(trend) >= 2 and trend[-2]:
            return (trend[-1] - trend[-2]) / trend[-2]
        return None

    def classify(tp) -> str:
        if tp["mentions"] == 0:
            return "drop"
        delta = day_delta(tp)
        if tp["status"] in ("new", "rising"):
            return "card"
        if delta is not None and abs(delta) >= 0.3 and tp["heat_today"] >= 60:
            return "card"
        if tp["status"] == "fading" and tp["heat_today"] < 60:
            return "drop"
        return "track"

    sections: dict[str, list] = {d: [] for d in DOMS}
    id_by_slug: dict[str, str] = {}
    tracking: list[dict] = []
    for tp in trends["topics"]:
        d = tp.get("domain") or "software"
        kind = classify(tp)
        if d not in sections or kind == "drop":
            continue
        if kind == "track" or len(sections[d]) >= 4:
            tracking.append({
                "slug": tp["slug"],
                "title": tp["display"],
                "status": tp["status"],
                "domain": d,
                "heat_today": tp["heat_today"],
                "heat_trend": tp["heat_trend"],
            })
            continue
        tid = f"{PREFIX[d]}-{len(sections[d]) + 1}"
        id_by_slug[tp["slug"]] = tid
        items = tp["top_items"]
        titles = "；".join(f"「{i['title'][:60]}」" for i in items[:3])
        delta = day_delta(tp)
        delta_txt = f"、較昨日 {delta:+.0%}" if delta is not None else ""
        sections[d].append({
            "id": tid,
            "slug": tp["slug"],
            "title": tp["display"],
            "status": tp["status"],
            "heat_today": tp["heat_today"],
            "heat_trend": tp["heat_trend"],
            "what": f"當日 {tp['mentions']} 則相關討論：{titles}。",
            "why_hot": f"熱度 {tp['heat_today']:.0f}（{STATUS_ZH.get(tp['status'], tp['status'])}"
                       f"{delta_txt}）——由管線統計自動判定。",
            "sources": [
                {"label": f"{i['source']}：{i['title'][:42]}",
                 "url": i.get("discussion_url") or i["url"]}
                for i in items[:4]
            ],
        })
    tracking.sort(key=lambda t: -t["heat_today"])

    # ---- 今日新訊：當日未歸戶熱點升格進正文（每天保證全新）----
    unassigned = trends.get("unassigned_hot", [])
    fresh = [{
        "title": u["title"][:90],
        "source": u["source"],
        "heat": u["heat"],
        "url": u.get("discussion_url") or u["url"],
    } for u in unassigned[:5]]

    # tldr：完整卡話題（賺到版面的）按熱度排；最熱的新訊若夠熱也佔一條
    ranked = sorted(
        (tp for tp in trends["topics"] if tp["slug"] in id_by_slug),
        key=lambda t: -t["heat_today"])
    tldr = [{
        "title": f"[{DOM_ZH.get(tp['domain'], tp['domain'])}] {tp['display']}",
        "text": f"熱度 {tp['heat_today']:.0f}（{STATUS_ZH.get(tp['status'], tp['status'])}），"
                f"共 {tp['mentions']} 則討論；重點連結見對應段落。",
        "deadline": None,
        "topic_ref": id_by_slug[tp["slug"]],
    } for tp in ranked[:3]]
    if fresh and fresh[0]["heat"] >= 200:
        tldr.insert(0, {
            "title": f"[新訊] {fresh[0]['title'][:60]}",
            "text": f"今日未歸戶最熱討論（{fresh[0]['source']}、熱度 {fresh[0]['heat']:.0f}），"
                    f"詳見「今日新訊」。",
            "deadline": None,
            "topic_ref": None,
        })
    tldr = tldr[:4]

    # 雷達區：新訊放不下的其餘未歸戶
    radar = [{
        "title": u["title"][:70],
        "note": f"{u['source']} · 熱度 {u['heat']:.0f}（未歸戶）",
        "url": u.get("discussion_url") or u["url"],
    } for u in unassigned[5:11]]

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
        "tech_intro": pick_tech_card(args.date),
        "tldr": tldr,
        "fresh": fresh,
        "sections": sections,
        "tracking": tracking,
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
