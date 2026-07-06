/* 全站底景 v2：WebGL 色霧（Shopify Editions 風格）。
   配方：fbm noise 做兩層 domain warping → 有機流動的彩色煙霧；
   滑鼠位置輕微扭曲流場（不是可見的光球）；film grain 消除色帶增加質感。
   手寫 WebGL1、零依賴（~4KB），DPR 減半渲染（煙霧本來就模糊，省 GPU）。
   WebGL 不可用時退回 CSS 色暈版（Shell 處理）。 */
import React, { useEffect, useRef, useState } from 'react'

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_t;
uniform vec2 u_mouse;   // -0.5..0.5，JS 端已做慣性平滑
uniform vec3 u_base;    // 紙色（--page）
uniform vec3 u_c1;      // --dom-ai
uniform vec3 u_c2;      // --dom-uiux
uniform vec3 u_c3;      // --dom-software
uniform float u_mix;    // 煙霧最大濃度（亮/暗主題不同）
uniform float u_grain;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + 1.0), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 1.7;
  float t = u_t * 0.018; // 流速：慢到像呼吸

  // 兩層 domain warp：q 扭 p、r 再扭一次，煙霧的「捲」就是這裡來的。
  // 滑鼠混進第二層的座標：游標移動時流場跟著歪，體感是「煙被推了一下」。
  vec2 m = u_mouse * 0.55;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t * 0.7));
  vec2 r = vec2(fbm(p + 2.4 * q + m + vec2(1.7, 9.2)),
                fbm(p + 2.4 * q - m + vec2(8.3, 2.8)));
  float f = fbm(p + 2.1 * r);

  // 三色調和：f 決定藍↔紫的走向，q.y 再滲一點綠
  vec3 smoke = mix(u_c1, u_c2, smoothstep(0.2, 0.8, f));
  smoke = mix(smoke, u_c3, smoothstep(0.55, 0.95, q.y) * 0.6);

  // 濃度塑形：f 高的地方煙濃，其餘露出紙色（等效遮罩，不用再蓋一層）
  float density = u_mix * smoothstep(0.25, 0.85, f);
  vec3 col = mix(u_base, smoke, density);

  // film grain：隨時間跳動的細顆粒，消 banding、給「材質感」
  float g = hash(gl_FragCoord.xy + fract(u_t) * vec2(17.0, 29.0)) - 0.5;
  col += g * u_grain;

  gl_FragColor = vec4(col, 1.0);
}
`

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  // #rrggbb → [r,g,b] 0..1（token 都是 hex，夠用）
  const n = parseInt(v.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export default function AuroraGL({ onFail }) {
  const ref = useRef(null)
  const sceneRef = useRef(null) // { gl, U, drawOnce } — init 一次後共用
  // onFail 走 ref：inline callback 每次 render 都是新 function，
  // 若放進 init 的依賴陣列，effect 會反覆重跑並 loseContext（畫面凍結成殘影）
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    const ob = new MutationObserver(() => setThemeTick((v) => v + 1))
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => ob.disconnect()
  }, [])

  /* 主題色 uniform 更新（獨立於 init）：WebGL context 不能重建——
     loseContext 後同一個 canvas 拿不回新 context，畫面會凍在最後一幀（殘影）。
     所以 context 只建一次，換主題只改顏色。 */
  const applyTheme = (gl, U) => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    gl.uniform3fv(U.base, cssColor('--page', dark ? '#0d0d0d' : '#f9f9f7'))
    gl.uniform3fv(U.c1, cssColor('--dom-ai', '#2a78d6'))
    gl.uniform3fv(U.c2, cssColor('--dom-uiux', '#4a3aa7'))
    gl.uniform3fv(U.c3, cssColor('--dom-software', '#1baf7a'))
    gl.uniform1f(U.mix, dark ? 0.5 : 0.34)
    gl.uniform1f(U.grain, dark ? 0.05 : 0.035)
  }
  useEffect(() => {
    const s = sceneRef.current
    if (!s || themeTick === 0) return
    applyTheme(s.gl, s.U)
    s.drawOnce() // reduced-motion 沒有迴圈，主題變更也要補畫一幀
  }, [themeTick])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, depth: false })
    if (!gl) { onFailRef.current?.(); return }

    const compile = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { onFailRef.current?.(); return }
    gl.useProgram(prog)

    // 全螢幕三角形（比兩個三角形的 quad 少一次 fragment 重疊）
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aLoc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(aLoc)
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0)

    const loc = (n) => gl.getUniformLocation(prog, n)
    const U = {
      base: loc('u_base'), c1: loc('u_c1'), c2: loc('u_c2'), c3: loc('u_c3'),
      mix: loc('u_mix'), grain: loc('u_grain'),
    }
    applyTheme(gl, U)
    const uRes = loc('u_res'), uT = loc('u_t'), uMouse = loc('u_mouse')

    // 煙霧本來就柔，用半解析度渲染省 GPU（再被瀏覽器放大，看不出差）
    const scale = Math.min(window.devicePixelRatio, 2) * 0.5
    const resize = () => {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * scale))
      canvas.height = Math.max(1, Math.floor(window.innerHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    // 滑鼠：目標值 → 每幀慣性趨近（0.03 = 很沉的慣性，煙才不會抖）
    let tx = 0, ty = 0, mx = 0, my = 0
    const onMove = (e) => {
      tx = e.clientX / window.innerWidth - 0.5
      ty = 0.5 - e.clientY / window.innerHeight // GL 的 y 向上
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const t0 = performance.now()
    const frame = () => {
      mx += (tx - mx) * 0.03
      my += (ty - my) * 0.03
      gl.uniform1f(uT, (performance.now() - t0) / 1000)
      gl.uniform2f(uMouse, mx, my)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reduced) raf = requestAnimationFrame(frame)
    }
    frame() // reduced-motion 也畫一張靜態煙霧，只是不動
    sceneRef.current = {
      gl, U,
      drawOnce: () => {
        gl.uniform1f(uT, (performance.now() - t0) / 1000)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
    }

    const onVis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden && !reduced) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      sceneRef.current = null
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, []) // init 只跑一次；主題變更走 uniform 更新、onFail 走 ref，都不重建 context

  return <canvas className="bg-smoke" ref={ref} aria-hidden="true" />
}
