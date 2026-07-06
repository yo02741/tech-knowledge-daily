/* 趨勢星系 — Three.js 版趨勢雲。
   讀法：本檔分五段 —— ①init 場景三件套 ②build 資料→3D 物件 ③interact 滑鼠拾取
   ④animate 渲染迴圈 ⑤dispose 清場。每段對應的概念解說在 docs/three-notes.md。
   這個元件用 React.lazy 動態載入：three 只有進星系模式才下載。 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { Text } from 'troika-three-text'
import { StatusBadge, fmtHeat } from './bits.jsx'

/* slug → 0..1 確定性亂數。用 Math.random 的話每次進頁詞條都跳位，
   固定種子讓「同一天的星系長一樣」，和 2D 版同一個哲學。 */
function seededRand(str) {
  let h = 2166136261
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

/* 四個群集各佔星系一個方位角（俯視看是四個扇區），同群的詞聚在一起。
   整體轉 45°：鏡頭在 +Z 軸上，四群落在四個對角方向，初始構圖左右平衡 */
const Q = Math.PI / 4
const AZIMUTH = { ai: Q, software: 3 * Q, devops: -3 * Q, uiux: -Q }

/* 主題 token 即時取值：主題切換時 re-init 會重新讀，3D 用色永遠跟 CSS 一致 */
function readPalette() {
  const css = getComputedStyle(document.documentElement)
  const tok = (name, fallback) => (css.getPropertyValue(name).trim() || fallback)
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  return {
    dark,
    // 霧色要貼近容器的 CSS 漸層背景（.galaxy-wrap），遠處物件才會自然淡進背景
    fog: dark ? '#0a0a16' : '#e9edf4',
    star: dark ? '#8f9bd4' : '#7d8296',
    dom: {
      ai: tok('--dom-ai', '#2a78d6'),
      software: tok('--dom-software', '#1baf7a'),
      devops: tok('--dom-devops', '#eb6834'),
      uiux: tok('--dom-uiux', '#4a3aa7'),
    },
  }
}

export default function Galaxy({ cloud, onFail }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)   // { word, x, y }（螢幕座標，developer 註：由 3D 座標投影而來）
  const [picked, setPicked] = useState(null) // 點選的詞條 → 資訊卡
  const [themeTick, setThemeTick] = useState(0) // 主題變更時 +1，觸發場景重建換色
  const pickedRef = useRef(null)
  pickedRef.current = picked

  /* 監聽 <html data-theme> 變化：亮暗切換時整個場景用新色重建（12 個詞成本極低） */
  useEffect(() => {
    const ob = new MutationObserver(() => setThemeTick((t) => t + 1))
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => ob.disconnect()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !cloud) return
    const pal = readPalette()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* ── ① init：場景三件套 scene / camera / renderer ─────────────── */
    let renderer
    try {
      // alpha:true → canvas 透明，天空背景交給 .galaxy-wrap 的 CSS 漸層
      //（scene.background 只吃單色，漸層天空用 CSS 做又便宜又跟主題連動）
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      onFail?.()
      return
    }
    // 手機高 DPR 螢幕全解析度渲染會吃爆 GPU，cap 在 2 是 three 社群慣例
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    wrap.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // 霧讓遠處詞條淡出，製造縱深；起迄距離抓「最遠詞條再往後一點」
    scene.fog = new THREE.Fog(pal.fog, 110, 220)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
    camera.position.set(0, 22, 118)

    /* ── ② build：資料 → 3D 物件 ─────────────────────────────────── */
    // 字級 ∝ sqrt(weight)，和 2D 版同一套比例哲學（sqrt 保中段對比）
    const weights = cloud.items.map((i) => i.weight)
    const wMin = Math.min(...weights), wMax = Math.max(...weights)
    const fontSize = (w) => {
      if (wMax === wMin) return 6
      const t = (Math.sqrt(w) - Math.sqrt(wMin)) / (Math.sqrt(wMax) - Math.sqrt(wMin))
      return 2.4 + t * (10.5 - 2.4)
    }

    // 群內按權重排序：最熱的靠星系核心，越冷越外圈
    const byDomain = {}
    for (const it of cloud.items) (byDomain[it.domain || 'software'] ??= []).push(it)
    const texts = []
    const wordGroup = new THREE.Group() // 詞條掛在群組上，方便整體置中
    scene.add(wordGroup)
    for (const [dom, items] of Object.entries(byDomain)) {
      items.sort((a, b) => b.weight - a.weight)
      items.forEach((it, i) => {
        const r1 = seededRand(it.slug + ':a'), r2 = seededRand(it.slug + ':b'), r3 = seededRand(it.slug + ':c')
        const radius = 18 + i * 15 + r1 * 7
        const phi = (AZIMUTH[dom] ?? 0) + (r2 - 0.5) * 1.5 // 扇區內 ±43° 散開
        const t = new Text()
        t.text = it.label
        // 字型不指定 → troika 預設字型 + 自動 Unicode fallback（中文詞條也能顯示）
        t.fontSize = fontSize(it.weight)
        t.fontWeight = 700
        t.color = new THREE.Color(pal.dom[dom] ?? '#888888')
        t.anchorX = 'center'
        t.anchorY = 'middle'
        // stale（今天沒出現的話題）壓暗，對應 2D 版的 cw-stale
        t.fillOpacity = it.last_seen === cloud.date ? 1 : 0.42
        t.position.set(
          radius * Math.cos(phi),
          (r3 - 0.5) * (10 + radius * 0.55), // 縱向壓扁 → 銀河盤面感
          radius * Math.sin(phi),
        )
        t.userData = { word: it, baseScale: 1, floatPhase: r1 * Math.PI * 2 }
        t.sync() // troika 非同步生成 SDF 字形，sync() 排進生成佇列
        wordGroup.add(t)
        texts.push(t)
      })
    }
    // 用「字級加權質心」把整團移回原點：最熱的群偏哪邊，畫面就會偏哪邊，
    // 置中後初始構圖不會半邊空、大字也不會貼著畫布邊被裁
    {
      const c = new THREE.Vector3()
      let wSum = 0
      for (const t of texts) {
        const w = t.fontSize * t.fontSize
        c.addScaledVector(t.position, w)
        wSum += w
      }
      if (wSum) wordGroup.position.copy(c.divideScalar(wSum).negate())
    }

    // 星塵背景：一個 Points 物件畫 1500 顆星，比 1500 個 Mesh 便宜三個數量級
    const starGeo = new THREE.BufferGeometry()
    const starPos = new Float32Array(1500 * 3)
    for (let i = 0; i < 1500; i++) {
      // 均勻散在半徑 120~200 的球殼上（用高斯向量正規化避免擠在軸上）
      const v = new THREE.Vector3(
        seededRand('sx' + i) - 0.5, seededRand('sy' + i) - 0.5, seededRand('sz' + i) - 0.5,
      ).normalize().multiplyScalar(120 + seededRand('sr' + i) * 80)
      starPos.set([v.x, v.y, v.z], i * 3)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({
      color: pal.star, size: pal.dark ? 0.9 : 1.0,
      transparent: true, opacity: pal.dark ? 0.8 : 0.65, sizeAttenuation: true,
    })
    scene.add(new THREE.Points(starGeo, starMat))

    // 後製：bloom 讓亮字發光——只在暗色開。亮底上 bloom 會連背景一起炸白
    //（threshold 是亮度門檻，白紙本身就超標），亮色主題走乾淨的「紙上銀河」。
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    if (pal.dark) {
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 1.05, 0.55, 0.08))
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true      // 拖曳有慣性尾勁，手感關鍵
    controls.dampingFactor = 0.06
    controls.autoRotate = !reduced
    controls.autoRotateSpeed = 0.55
    controls.minDistance = 30
    controls.maxDistance = 180
    controls.enablePan = false          // 平移容易迷航，鎖住只給旋轉+縮放

    /* ── ③ interact：raycast 滑鼠拾取 ────────────────────────────── */
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let hovered = null
    let downAt = null
    const pick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect()
      // 螢幕像素 → NDC（-1..1）：raycaster 吃的是投影空間座標
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(texts, false)[0]
      return hit ? hit.object : null
    }
    const project = (obj) => {
      // 3D 世界座標投影回螢幕像素，tooltip 才知道要放哪
      const rect = renderer.domElement.getBoundingClientRect()
      const v = new THREE.Vector3()
      obj.getWorldPosition(v)
      v.project(camera)
      return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height }
    }
    const onMove = (e) => {
      const t = pick(e)
      if (t !== hovered) {
        hovered = t
        renderer.domElement.style.cursor = t ? 'pointer' : 'grab'
        setHover(t ? { word: t.userData.word, ...project(t) } : null)
      }
    }
    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY } }
    const onUp = (e) => {
      // 位移小於 6px 才算點擊，避免拖曳旋轉誤觸選字
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return
      const t = pick(e)
      setPicked(t ? t.userData.word : null)
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    /* ── ④ animate：渲染迴圈 ────────────────────────────────────── */
    const t0 = performance.now()
    const tick = () => {
      const t = (performance.now() - t0) / 1000 // 經過秒數，驅動漂浮動畫
      for (const txt of texts) {
        // billboard：文字永遠面向鏡頭（否則轉到側面變一條線）
        txt.quaternion.copy(camera.quaternion)
        if (!reduced) txt.position.y += Math.sin(t * 0.7 + txt.userData.floatPhase) * 0.008
        // hover / 選中的詞條放大一點，線性插值讓縮放有過渡不跳格
        const target = (hovered === txt || pickedRef.current === txt.userData.word) ? 1.22 : 1
        const s = txt.scale.x + (target - txt.scale.x) * 0.15
        txt.scale.setScalar(s)
      }
      controls.update() // damping 與 autoRotate 都靠每幀 update 推進
      composer.render()
    }
    renderer.setAnimationLoop(tick)
    // 分頁切走就停迴圈，省電也避免背景吃 GPU
    const onVis = () => renderer.setAnimationLoop(document.hidden ? null : tick)
    document.addEventListener('visibilitychange', onVis)

    // RWD：容器多大，畫布與相機比例就跟多大
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    /* ── ⑤ dispose：清場 ─────────────────────────────────────────── */
    // WebGL 資源不歸 GC 管，離開路由不手動釋放就是實打實的顯存洩漏
    return () => {
      renderer.setAnimationLoop(null)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      controls.dispose()
      texts.forEach((t) => t.dispose())
      starGeo.dispose()
      starMat.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [cloud, themeTick, onFail])

  return (
    <div className="galaxy-wrap" ref={wrapRef}>
      {hover && !picked && (
        <div className="galaxy-tip" style={{ left: hover.x, top: hover.y }}>
          <strong>{hover.word.display}</strong>
          <span>{fmtHeat(hover.word.weight)} · 點擊看詳情</span>
        </div>
      )}
      {picked && (
        <div className="galaxy-card" role="dialog" aria-label={picked.display}>
          <button className="galaxy-card-close" aria-label="關閉" onClick={() => setPicked(null)}>×</button>
          <p className="galaxy-card-title">{picked.display}</p>
          <p className="galaxy-card-meta">
            <StatusBadge status={picked.status} />
            <span>近 {cloud.window_days} 天熱度 {fmtHeat(picked.weight)}</span>
          </p>
          <a className="galaxy-card-link" href={`#/${picked.last_seen}/${picked.slug.split('#')[0]}`}>
            看最近一期（{picked.last_seen}）→
          </a>
        </div>
      )}
      <p className="galaxy-hint">拖曳旋轉 · 滾輪縮放 · 點字看詳情</p>
    </div>
  )
}
