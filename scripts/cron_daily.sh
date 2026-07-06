#!/usr/bin/env bash
# 每日 headless 跑 /daily（由系統 crontab 呼叫）。
# 環境極簡：cron 沒有互動 PATH，這裡自己組。
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v20.19.5/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."

mkdir -p logs
LOG="logs/cron-$(date +%F).log"

{
  echo "=== cron_daily $(date -Is) ==="
  # 權限走專案 .claude/settings.json 的 allowlist（僅管線指令）+ acceptEdits，
  # 不使用 --dangerously-skip-permissions
  claude -p "執行 /daily 每日流程（headless cron 模式：今日報告已存在就直接結束，不要問問題）" \
    --permission-mode acceptEdits \
    --max-turns 80
  echo "=== exit=$? $(date -Is) ==="
} >> "$LOG" 2>&1

# log 保留 30 天
find logs -name 'cron-*.log' -mtime +30 -delete 2>/dev/null
exit 0
