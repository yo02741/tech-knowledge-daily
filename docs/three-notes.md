# Three.js 學習導讀 — 以趨勢星系為教材

對讀對象：`frontend/src/Galaxy.jsx`。這份筆記按檔案裡的 ①〜⑤ 分段走，
每段講「這裡用了 Three.js 的什麼概念、為什麼這樣寫」，最後給幾個改著玩的實驗。

## 心智模型：三件套 + 迴圈

Three.js 的一切都是這個循環：

```
Scene（場景圖）  ←  你把物件加進來
Camera（相機）   ←  決定從哪看、看多廣
Renderer（渲染器）→ 每幀把「相機看到的場景」畫到 <canvas>
```

`renderer.setAnimationLoop(tick)` 就是心跳，每幀（通常 60fps）呼叫一次 `tick()`。
所有「會動」的東西——自轉、漂浮、hover 縮放——都是在 tick 裡改物件屬性，下一幀自然生效。
**不是**改了就重畫，而是持續重畫、你持續改。這跟 React「狀態變了才 render」是相反的世界觀，
也是為什麼整個 3D 場景要用 `useEffect` 包起來、跟 React 的渲染週期隔離。

## ① init — 場景三件套（Galaxy.jsx 的第一段）

- `WebGLRenderer({ antialias: true })`：建 renderer 就是建 WebGL context，可能失敗（老機器、
  被停用），所以包 try/catch 走 `onFail` 退回 2D。
- `setPixelRatio(Math.min(devicePixelRatio, 2))`：Retina 螢幕 DPR 可到 3，全解析度渲染
  = 9 倍像素量。cap 在 2 是社群慣例，肉眼幾乎無差。
- `PerspectiveCamera(fov, aspect, near, far)`：fov 是垂直視角。near/far 夾出「看得到的範圍」，
  範圍拉太大會浪費深度緩衝精度（z-fighting 的根源之一）。
- `scene.fog`：霧不是特效，是**深度提示**——遠的東西往背景色淡掉，人眼就讀得出前後。

## ② build — 資料 → 3D 物件

- 文字用 `troika-three-text` 的 `Text`，不是 three 內建的 TextGeometry。差別：TextGeometry
  是把字擠成 3D 網格（重、鋸齒），troika 是 **SDF（signed distance field）**——把字形存成
  距離場貼圖，shader 依距離著色，任意縮放都銳利，一個字幾 KB。業界畫 3D 文字幾乎都走這條。
- `t.sync()` 是非同步的：SDF 在 web worker 生成，好了自己出現。所以第一幀看不到字是正常的。
- 佈局是純數學，跟 Three.js 無關：極座標 `(radius, phi)` → `x = r·cos(φ), z = r·sin(φ)`，
  四個群集各分一個方位角。**確定性亂數**（seededRand）讓同一天版面固定——跟 2D 版同哲學。
- 星塵是一個 `THREE.Points` 物件畫 1500 顆星：GPU 一次 draw call。如果用 1500 個 Mesh，
  就是 1500 次 draw call——效能差三個數量級。這是 three 效能的第一課：**物件數 < 頂點數**。
- 加權質心置中：資料哪邊重、畫面就偏哪邊，所以算完位置後把整個 Group 平移，讓「視覺質量」
  的中心回到原點。Group 是場景圖的樹狀結構：動 parent，全部小孩跟著動。

## ③ interact — raycast 拾取

滑鼠是 2D 的、場景是 3D 的，怎麼知道滑到誰？**Raycaster**：

```
螢幕像素 → NDC（-1..1 的投影座標）→ 從相機射一條射線 → 射線打到哪些物件
```

`intersectObjects(texts)` 回傳按距離排序的命中清單，取第一個就是「滑鼠下最近的物件」。
反方向（3D → 2D）是 `vector.project(camera)`，把世界座標投影回螢幕，tooltip 定位就靠它。
注意用 `getWorldPosition()` 不是 `.position`——後者是相對 parent 的局部座標。

點擊 vs 拖曳的區分：pointerdown 記座標，pointerup 位移 < 6px 才算點擊。
沒這步的話每次拖曳旋轉放開都會誤觸選字。

## ④ animate — 迴圈裡做的四件事

1. **Billboard**：`txt.quaternion.copy(camera.quaternion)` 讓文字永遠面向鏡頭。
   quaternion 是旋轉的數學表示，直接抄相機的旋轉 = 跟相機保持平行。
2. 漂浮：`sin(t · 頻率 + 相位)`，相位來自 slug hash，每個詞的節奏不同步才像活的。
3. 縮放過渡：`s += (target - s) * 0.15` 是最便宜的 easing（指數趨近），一行搞定
   hover 放大的順滑感，不用 tween 函式庫。
4. `controls.update()`：OrbitControls 的 damping（慣性）與 autoRotate 都靠每幀 update 推進。

後製（post-processing）：`EffectComposer` 把「渲染結果」當圖片再加工。
`UnrealBloomPass` 抽出亮度超過 threshold 的部分模糊放大疊回去 = 發光。
**亮色主題不開 bloom**：白紙本身就超過亮度門檻，開了會整片炸白——bloom 是加法混合，
只適合暗底。這是為什麼霓虹燈風格的網站清一色深色。

## ⑤ dispose — 為什麼要手動清

WebGL 的 buffer/texture 活在 GPU，**JS 的垃圾回收管不到**。React 元件 unmount 只是把
canvas 從 DOM 拔掉，顯存還占著。所以 cleanup 要逐一 `dispose()`：texts、geometry、
material、renderer。切幾次路由就漏幾份場景，這是 three + SPA 最常見的記憶體洩漏。

另外兩個省資源的習慣：
- `visibilitychange` 時停掉 animation loop（背景分頁不燒 GPU）。
- `ResizeObserver` 而不是 window resize 事件：容器變大小（不只視窗）都會觸發。

## 改著玩（由淺入深）

1. **調 bloom**：`UnrealBloomPass(_, strength, radius, threshold)` 三個參數各拉大拉小看效果。
2. **換佈局**：把極座標改成 fibonacci 球面（搜 "fibonacci sphere"），星系變星球。
3. **加軌跡線**：`THREE.Line` + `EllipseCurve` 給每個群集畫一圈軌道。
4. **星塵動起來**：在 tick 裡旋轉 Points（`stars.rotation.y += 0.0002`），視差感立現。
5. **進階**：把 hover 高亮改成 `OutlinePass`；或給文字加 `curveRadius` 讓字貼著球面彎。

## 選型備忘

- `three` 本體 ~600KB（gzip ~160KB），所以走 `React.lazy` 動態載入，只有進星系模式才下載。
- `troika-three-text` 額外處理了中文：內建 Unicode fallback 字型解析（從 CDN 抓字形資料），
  未來詞條出現中文也能顯示。
- OrbitControls / EffectComposer 這些不在 three 核心，從 `three/addons/...` 匯入。
