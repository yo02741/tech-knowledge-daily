#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-auth>=2", "requests>=2"]
# ///
"""把當日報告與趨勢存進 Firestore（資料儲存層，部署仍走 GitHub Pages）。

  store_firestore.py --date 2026-07-06

憑證來源（擇一）：
  - 環境變數 FIREBASE_SERVICE_ACCOUNT：service account key 的 JSON 內容（CI 用）
  - 環境變數 GOOGLE_APPLICATION_CREDENTIALS：key 檔路徑（本機用）
兩者皆缺 → 印出提示後 exit 0（跳過，不擋管線）。

寫入結構（文件 ID = 日期）：
  reports/{date}: {date, json(整份報告字串), topicCount, tldrCount, generated, storedAt}
  trends/{date} : {date, json(整份 trends 字串), storedAt}
"""
import argparse
import datetime
import json
import os
import sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCOPES = ["https://www.googleapis.com/auth/datastore"]


def load_credentials():
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if raw:
        info = json.loads(raw)
    else:
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not path or not os.path.exists(path):
            return None, None
        with open(path, encoding="utf-8") as f:
            info = json.load(f)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return creds, info["project_id"]


def upsert(project: str, token: str, collection: str, doc_id: str, fields: dict) -> None:
    url = (f"https://firestore.googleapis.com/v1/projects/{project}"
           f"/databases/(default)/documents/{collection}/{doc_id}")
    body = {"fields": {k: encode(v) for k, v in fields.items()}}
    res = requests.patch(url, json=body,
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if res.status_code != 200:
        raise RuntimeError(f"Firestore {collection}/{doc_id}: "
                           f"HTTP {res.status_code} {res.text[:300]}")


def encode(v):
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, datetime.datetime):
        return {"timestampValue": v.strftime("%Y-%m-%dT%H:%M:%SZ")}
    return {"stringValue": str(v)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    args = ap.parse_args()

    creds, project = load_credentials()
    if creds is None:
        print("store_firestore: 未設定 FIREBASE_SERVICE_ACCOUNT / "
              "GOOGLE_APPLICATION_CREDENTIALS，跳過（不擋管線）")
        return 0
    creds.refresh(Request())
    now = datetime.datetime.now(datetime.timezone.utc)

    report_path = os.path.join(ROOT, "site", "data", "reports", f"{args.date}.json")
    trends_path = os.path.join(ROOT, "data", "raw", args.date, "trends.json")

    stored = []
    if os.path.exists(report_path):
        with open(report_path, encoding="utf-8") as f:
            report = json.load(f)
        topic_count = sum(len(v) for v in report.get("sections", {}).values())
        upsert(project, creds.token, "reports", args.date, {
            "date": args.date,
            "json": json.dumps(report, ensure_ascii=False),
            "topicCount": topic_count,
            "tldrCount": len(report.get("tldr", [])),
            "generated": report.get("generated", "claude"),
            "storedAt": now,
        })
        stored.append(f"reports/{args.date}")
    if os.path.exists(trends_path):
        with open(trends_path, encoding="utf-8") as f:
            trends_text = f.read()
        upsert(project, creds.token, "trends", args.date, {
            "date": args.date,
            "json": trends_text,
            "storedAt": now,
        })
        stored.append(f"trends/{args.date}")

    if not stored:
        print(f"store_firestore: {args.date} 沒有可存的檔案", file=sys.stderr)
        return 4
    print(f"store_firestore: 已寫入 {project} -> {', '.join(stored)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, requests.RequestException) as e:
        print(f"store_firestore: {e}", file=sys.stderr)
        sys.exit(4)
