#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""發佈前置：校驗報告 JSON → 重建 index.json。

  publish.py            校驗全部報告 + 更新 index

實際部署由 git push 觸發 GitHub Actions（.github/workflows/deploy-pages.yml）
build 前端並發佈到 GitHub Pages——本 script 只負責把關資料品質。

exit：0 成功 / 1 校驗失敗（壞報告擋下，不得 push）
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(ROOT, "site", "data", "reports")

TOPIC_REQUIRED = ("id", "title", "status", "what", "why_hot", "sources")
STATUSES = {"new", "rising", "ongoing", "fading"}


def validate_report(path: str) -> list[str]:
    errs = []
    name = os.path.basename(path)
    try:
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
    except json.JSONDecodeError as e:
        return [f"{name}: JSON 解析失敗 {e}"]

    date = name.removesuffix(".json")
    if r.get("date") != date:
        errs.append(f"{name}: date 欄位 {r.get('date')!r} 與檔名不符")
    for key in ("date", "tldr", "sections", "radar", "data_quality"):
        if key not in r:
            errs.append(f"{name}: 缺頂層欄位 {key}")
    for i, t in enumerate(r.get("tldr", [])):
        for k in ("title", "text"):
            if not t.get(k):
                errs.append(f"{name}: tldr[{i}] 缺 {k}（要一句話標題 + 簡短敘述）")
    for dom in ("ai", "software", "devops", "uiux"):
        for i, t in enumerate(r.get("sections", {}).get(dom, [])):
            missing = [k for k in TOPIC_REQUIRED if k not in t or t[k] in ("", [], None)]
            if missing:
                errs.append(f"{name}: sections.{dom}[{i}] 四要素/欄位缺 {missing}")
            if t.get("status") not in STATUSES:
                errs.append(f"{name}: sections.{dom}[{i}] status 非法 {t.get('status')!r}")
            for s in t.get("sources", []):
                if not re.match(r"https?://", s.get("url", "")):
                    errs.append(f"{name}: sections.{dom}[{i}] 來源 URL 非法 {s.get('url')!r}")
    ti = r.get("tech_intro")  # 選配欄位：每日一技術簡介卡片；存在時才校驗
    if ti is not None:
        for k in ("term", "domain"):
            if not ti.get(k):
                errs.append(f"{name}: tech_intro 缺 {k}")
        if not isinstance(ti.get("intro"), list) or not ti.get("intro"):
            errs.append(f"{name}: tech_intro 缺 intro（要非空 list）")
        for j, ln in enumerate(ti.get("links", [])):
            if not re.match(r"https?://", ln.get("url", "")):
                errs.append(f"{name}: tech_intro links[{j}] URL 非法 {ln.get('url')!r}")
    return errs


def build_index() -> list[dict]:
    entries = []
    for path in sorted(glob.glob(os.path.join(REPORTS_DIR, "20??-??-??.json")), reverse=True):
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        sections = r.get("sections", {})
        all_topics = [t for dom in ("ai", "software", "devops", "uiux") for t in sections.get(dom, [])]
        top = max(all_topics, key=lambda t: t.get("heat_today", 0), default=None)
        entries.append({
            "date": r["date"],
            "weekday": r.get("weekday", ""),
            "tldr_count": len(r.get("tldr", [])),
            "topic_count": len(all_topics),
            "top_topic": top["title"] if top else "",
        })
    with open(os.path.join(REPORTS_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return entries


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-deploy", action="store_true",
                    help="相容舊呼叫；部署本來就交給 git push + CI，此旗標無作用")
    ap.parse_args()

    errs = []
    reports = glob.glob(os.path.join(REPORTS_DIR, "20??-??-??.json"))
    for path in sorted(reports):
        errs += validate_report(path)
    if errs:
        print("publish: 校驗失敗，不得 push：", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        return 1
    entries = build_index()
    print(f"publish: 校驗 {len(reports)} 份報告 OK，index {len(entries)} 期；"
          f"git push 後由 GitHub Actions 部署 Pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
