#!/usr/bin/env bash
# 一鍵抓全部來源 + 清理過期 raw。用法：fetch_all.sh [YYYY-MM-DD]
# exit：0 全成功 / 2 部分失敗（可繼續出報告）/ 1 全部失敗
set -uo pipefail
cd "$(dirname "$0")/.."

DATE="${1:-$(date +%F)}"
RAW="data/raw/$DATE"
RETENTION=$(python3 -c "import json;print(json.load(open('config/sources.json'))['retention_days'])")
mkdir -p "$RAW"

# 回溯模式：非今天只有 HN 能回查歷史（Reddit/GitHub Trending 無歷史排行）
if [ "$DATE" != "$(date +%F)" ]; then
  uv run scripts/fetch_hn.py --for-date "$DATE" --out "$RAW/hn.json"
  hn_rc=$?
  echo "fetch_all: 回溯模式 date=$DATE 僅 HN（hn_rc=$hn_rc），Reddit/GitHub 無歷史可撈"
  [ "$hn_rc" -eq 0 ] && exit 2 || exit 1   # 恆為部分資料 → exit 2
fi

uv run scripts/fetch_hn.py --out "$RAW/hn.json"
hn_rc=$?

uv run scripts/fetch_github.py --config config/sources.json --out "$RAW/github.json"
gh_rc=$?

uv run scripts/fetch_reddit.py --config config/sources.json --outdir "$RAW"
reddit_rc=$?

# 清理超過 retention 的 raw 日期資料夾
find data/raw -mindepth 1 -maxdepth 1 -type d -name '20*' \
  ! -newermt "$RETENTION days ago" -exec rm -rf {} \; 2>/dev/null

echo "fetch_all: date=$DATE hn_rc=$hn_rc gh_rc=$gh_rc reddit_rc=$reddit_rc files=$(ls "$RAW" | wc -l)"

if [ "$hn_rc" -ne 0 ] && [ "$gh_rc" -ne 0 ] && [ "$reddit_rc" -eq 1 ]; then exit 1; fi
if [ "$hn_rc" -ne 0 ] || [ "$gh_rc" -ne 0 ] || [ "$reddit_rc" -ne 0 ]; then exit 2; fi
exit 0
