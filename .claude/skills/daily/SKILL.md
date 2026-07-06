---
name: daily
description: 每日技術熱點偵測（公開趨勢日報）。無參數=完整每日流程（抓取→趨勢分析→寫報告→發佈）；帶參數（議題名）=深挖該議題寫 deep-dive 筆記（本機私人，不進版控）。
argument-hint: "[議題名（可選，深挖模式）]"
---

# /daily — 每日技術熱點

分工原則（同 CLAUDE.md）：**數字歸 script、語意歸 agent**。熱度與狀態一律採用 trends.json 的值，不得自行估算或改寫。

## 無參數：每日流程

1. **Catch-up 檢查**：比對 `site/data/reports/` 最新日期與今天。落後且 `data/raw/<缺日>/` 有資料 → 先對缺日做步驟 3-7 補報告；無 raw 的缺日跳過（抓不回當時熱度）。
2. **重複檢查**：今日報告已存在時看 `generated` 欄位——是 `"template"`（CI 模板版）→ **升級模式**：照常走完流程，用 Claude 敘事版覆寫（`generated: "claude"`，重寫 what/why_hot 敘事與 tldr，統計數字仍取自 trends.json）；是 Claude 版 → headless 直接結束，互動模式問使用者要覆寫還是結束。
3. `bash scripts/fetch_all.sh`（exit 2 = 部分來源失敗，繼續但記入 data_quality；exit 1 = 全掛，中止並回報）。
4. `uv run scripts/trend_state.py analyze --date <日期> --commit`
5. **讀取**：`data/raw/<日期>/trends.json`、最近 3 份 `site/data/reports/*.json`（延續既有 topic 的敘事脈絡，避免每天重寫一樣的背景）。**報告是公開內容，不讀 PROFILE.md、不寫任何個人工作流相關文字。**
6. **處理 unassigned_hot**（語意歸類，這是唯一改 ledger 的環節）：
   - 確為值得追蹤的新議題 → `uv run scripts/trend_state.py add-topic <slug> --display "..." --domain ai|software|devops|uiux --alias "..." --alias "..." --date <日期>`（alias 給 2-4 個常見寫法，英文小寫）
   - 是既有 topic 的新講法 → `uv run scripts/trend_state.py add-alias <slug> "<別名>"`
   - 一次性雜訊（單日梗文、與技術趨勢無關）→ 忽略
   - 新增/併入後 **重跑步驟 4**（同日重跑會覆蓋當日 history，安全），讓新 topic 拿到正確熱度與 top_items。
7. **寫報告** `site/data/reports/<日期>.json`（schema 見下）。
8. `uv run scripts/trend_state.py cloud --date <日期> --days 14`（更新趨勢雲資料 `site/data/trend-cloud.json`）。
9. `uv run scripts/publish.py`（校驗+index；校驗失敗＝報告不合格，修完才准 push）。
10. `uv run scripts/store_firestore.py --date <日期>`（Firestore 資料儲存；無憑證自動跳過）。
11. `git add site/data data/state && git commit -m "report: <日期>" && git push`——push 觸發 GitHub Actions build 前端並部署 GitHub Pages。push 失敗（離線等）報告仍完成，提示稍後手動 push。

## 帶參數：深挖模式（例 `/daily fable 5 退役`）

1. `uv run scripts/fetch_hn.py --query "<英文關鍵字>" --days 7 --out <scratchpad>/hn-q.json` 與 `uv run scripts/fetch_reddit.py --query "<英文關鍵字>" --days 7 --out <scratchpad>/reddit-q.json`。**不碰 ledger、不 --commit**。
2. 挑最熱 2-3 個討論串用 WebFetch 讀實際評論（僅深挖模式允許 WebFetch）。
3. 寫 `reports/deep-dives/<日期>-<slug>.md`：時間軸、社群共識與分歧、對我的影響（引 PROFILE.md）、行動方案分「今天就做（<1h）/ 本週排入 / 觀望即可」。**deep-dive 是私人筆記：`reports/` 已 gitignore，不進公開 repo、不上網站**，個人化分析只出現在這裡。

## 報告 JSON schema

```json
{
  "date": "YYYY-MM-DD", "weekday": "一", "generated": "claude",
  "tldr": [{"title": "一句話標題", "text": "2-3 句的簡短敘述（發生什麼、為何重要）",
            "deadline": "07-07 或 null", "topic_ref": "ai-1 或 null"}],
  "sections": {
    "ai": [{"id": "ai-1", "title": "...", "status": "new|rising|ongoing|fading",
            "heat_today": 540, "heat_trend": [210, 540],
            "what": "...", "why_hot": "...",
            "sources": [{"label": "HN 討論", "url": "https://..."}]}],
    "software": [], "devops": [], "uiux": []
  },
  "radar": [{"title": "...", "note": "一行", "url": "https://..."}],
  "data_quality": [{"source": "reddit-*", "note": "RSS fallback，分數為估值"}],
  "tech_intro": {"id": "ai-context-window", "domain": "ai", "term": "...", "tagline": "...",
                 "intro": ["...", "..."], "level": "入門", "links": [{"label": "...", "url": "https://..."}]}
}
```

`tech_intro` = 每日一技術簡介：`site/data/tech-cards.json` 的題庫卡片**原樣嵌入**，由 gen_report.py `pick_tech_card()` 依日期確定性選卡（同日必同卡）。/daily 升級模式**沿用不改**既有的 tech_intro；報告缺這欄時用 `uv run scripts/gen_report.py --date <日期> --inject-tech-intro` 補。

## 品質硬規則

- **報告是公開內容**：不含任何個人化欄位（無 impact / 無行動清單），不引用 PROFILE、不出現特定個人工作流的描述。
- 每個 section topic 三要素（what/why_hot/sources）**缺一不可**——publish.py 會校驗擋下。
- **每群集保底**：四個群集每天各至少 1-2 條該 domain 當日最熱進正文；當日該群集資料確實貧乏（來源失敗或無像樣討論）才允許空，並記入 data_quality。
- `heat_today`/`heat_trend`/`status` 直接抄 trends.json，不得編造。
- 來源 URL 只能用 raw 資料裡實際存在的（trends.json 的 top_items / unassigned_hot），**禁止捏造連結**。
- 有硬期限的 tldr 排最前（客觀期限如模型退役日、CVE 修補期限）；`deadline` 用 MM-DD。
- tldr 最多 5 條，每條必有 `title`（一句話）+ `text`（2-3 句中性敘述）；有對應 section topic 就填 `topic_ref`（前端會做成跳轉連結）。
- 四個群集固定為 ai（AI 趨勢）/ software（前後端）/ devops / uiux（UI/UX），優先序照此順序；每 domain section 最多 4 個 topic，寧缺勿濫，無熱點就空陣列（前端 catalog tab 會顯示「今日無」）。
- `data_quality`：照抄 trends.json 的 source_health 非 ok 項 + fetch_all 的失敗訊息。
- 語言：全部繁體中文（標題内的專有名詞保留英文）。
- **補卡規則**：本機 /daily 執行時，若當日熱點涉及題庫沒有的重要概念，新增 1 張卡進 `site/data/tech-cards.json`——id 格式 `<domain前綴>-<slug>`（前綴照既有慣例：`ai-`/`fe-`/`be-`/`ux-`/`do-`）、白話繁中、`intro` 兩段、連結用穩定官方文件。**不刪不改既有卡**（日期輪轉依賴檔案內順序，只能 append 到檔尾）。
