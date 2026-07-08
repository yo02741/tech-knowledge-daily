#!/usr/bin/env bash
# 本機 cron 用：準點觸發每日管線。
# GitHub 自身的 schedule 對低流量 repo 遲到可達小時級（實測 07/07 遲 5 小時、
# 07/08 上午整班未到），所以本機 08:37 準點發車，GitHub 排程當備援。
# 管線冪等，重複觸發無害。安裝：
#   echo '37 8 * * * $HOME/Desktop/tech-knowledge-daily/scripts/trigger_ci.sh' | crontab -
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin"
gh workflow run daily-pipeline.yml -R yo02741/tech-knowledge-daily \
  >> "$HOME/.tkd-cron.log" 2>&1 \
  && echo "$(date '+%F %T') dispatched" >> "$HOME/.tkd-cron.log"
