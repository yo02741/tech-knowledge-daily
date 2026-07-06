# tech-knowledge-daily

每日技術熱點日報（公開版）。抓 Hacker News、GitHub Trending、Reddit 技術版，用 topic ledger 分辨「突然爆發 vs 持續討論」，產出雜誌風格的每日趨勢報告，依 AI 趨勢 / 前後端 / DevOps / UI/UX 四群集呈現。

- **GitHub Pages**：https://yo02741.github.io/tech-knowledge-daily/
- **Firebase Hosting**：https://tech-knowledge-daily.web.app

## 運作方式

```
每日 08:07（台北）GitHub Actions 自動：
  fetch_all.sh → data/raw/<date>/*.json        HN Algolia / GitHub Trending / Reddit RSS
  trend_state.py analyze → trends.json          熱度計算 + new/rising/ongoing/fading 狀態機
  gen_report.py                                 模板報告（純統計）
  store_firestore.py                            Firestore 資料儲存（reports/ + trends/）
  push → 雙部署（Pages + Firebase Hosting）
```

本機 `/daily`（Claude Code）可把當日模板報告升級為 Claude 敘事版：語意歸類新議題進 ledger、重寫熱點敘事與本期要點。`/daily <議題>` 產深挖筆記（私人，不進版控）。

## 手動觸發

| 動作 | 指令 |
|---|---|
| 補跑今天 | `gh workflow run daily-pipeline.yml` |
| 回溯某天（僅 HN 歷史） | `gh workflow run daily-pipeline.yml -f date=YYYY-MM-DD` |
| 本機升級報告 | Claude Code 裡 `/daily` |

設定集中在 `config/sources.json`（來源清單、四群集關鍵詞與權重、retention）。agent 行為守則見 `CLAUDE.md`。
