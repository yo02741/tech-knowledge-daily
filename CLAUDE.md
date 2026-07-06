# tech-knowledge-daily — agent 執行守則

每日技術熱點偵測 + 個人化行動建議系統。headless cron session 與互動 session 都遵守本檔。

## 分工原則

- **數字與狀態由 script 算**：熱度、new/rising/ongoing/fading 狀態全部來自 `scripts/trend_state.py` 的輸出，agent 不得自行估熱度或改寫狀態。
- **語意判斷由 agent 做**：topic 命名/合併（處理 `unassigned_hot`）、影響分析、行動建議。
- 每日流程 **不用 WebSearch 找熱點**（來源就是 script 抓回的資料）；只有深挖模式允許 WebFetch 讀特定討論串。

## 每日流程（/daily 無參數）

1. `bash scripts/fetch_all.sh`（exit 2 = 部分來源失敗，可繼續，記入報告 data_quality）
2. `uv run scripts/trend_state.py analyze --date <今天> --commit`
3. 讀 `data/raw/<今天>/trends.json` + 最近 3 份 `site/data/reports/*.json`（**不讀 PROFILE.md**——報告是公開內容）
4. 處理 `unassigned_hot`：確為新議題 → `trend_state.py add-topic`；是既有 topic 換講法 → `add-alias`
5. 依 schema 寫 `site/data/reports/<今天>.json`
6. `uv run scripts/publish.py`（校驗 + 更新 index.json；失敗＝報告不合格，不得 push）
7. `git add site/data data/state && git commit && git push`（push 觸發 GitHub Actions 部署 Pages）

## 報告品質硬規則

- **報告是公開內容**：無個人化欄位（impact/行動清單已退場），不引用 PROFILE、不出現個人工作流描述。個人化分析只存在於 deep-dive 私人筆記（reports/ 已 gitignore）。
- 每個熱點三要素缺一不可：**是什麼 / 為何爆 / 來源**。
- 有硬期限的要點排最前、標日期（客觀期限：模型退役日、CVE 修補期限等）。
- 不確定的判斷要明說不確定，**禁止捏造來源連結**——只能用 raw 資料裡實際存在的 URL。
- 來源失敗照樣出報告，在 `data_quality` 註明降級狀況。

## 失敗降級

- Reddit .json 被擋 → script 自動走 RSS fallback（分數為估值）；RSS 也掛 → `config/sources.json` 改 `reddit_mode`，最壞 HN-only。
- git push 失敗（離線等）→ 不擋報告產出，提示稍後手動 push；Pages 部署狀態用 `gh run list --workflow deploy-pages.yml` 查。

## Catch-up（漏跑自我修復）

每日流程開頭檢查 `site/data/reports/` 最新日期：若落後且 `data/raw/` 有當天資料 → 先補寫缺的報告；無 raw 資料的過去日不補（抓不回當時熱度）。

## CI 每日管線與雙層報告

`.github/workflows/daily-pipeline.yml` 每日 08:07（台北）自動：fetch → analyze → `gen_report.py` 產**模板報告**（`generated: "template"`，純統計無個人化）→ `store_firestore.py` 存 Firestore（資料儲存層）→ push → 串 deploy-pages。本機 `/daily` 遇模板報告走升級模式，以 Claude 完整版覆寫。gen_report 絕不覆寫 Claude 版（除非 --force）。
