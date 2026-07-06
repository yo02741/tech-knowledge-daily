import React from 'react'

export const STATUS = {
  new:     { label: '新爆發', icon: '✦', cls: 'st-new' },
  rising:  { label: '上升',   icon: '↗', cls: 'st-rising' },
  ongoing: { label: '持續',   icon: '→', cls: 'st-ongoing' },
  fading:  { label: '退燒',   icon: '↘', cls: 'st-fading' },
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.ongoing
  return (
    <span className={`badge ${s.cls}`}>
      <span className="badge-icon" aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  )
}

export function DeadlineChip({ deadline }) {
  if (!deadline) return null
  return (
    <span className="deadline-chip">
      <span aria-hidden="true">⏱</span> {deadline} 前
    </span>
  )
}

/** 單序列熱度走勢：2px 線 + 端點 accent 圓（帶 2px surface ring）。
 *  只有一個資料點（首日收錄）畫不成走勢，孤點看起來像渲染錯誤 → 不畫，
 *  熱度數字已傳達當日值；隔日起 ledger 累積歷史就會出現線。 */
export function Sparkline({ trend }) {
  const W = 96, H = 28, PAD = 5
  const pts = (trend || []).map(Number).filter((v) => !Number.isNaN(v))
  if (pts.length < 2) return null
  const max = Math.max(...pts, 1)
  const min = Math.min(...pts, 0)
  const span = max - min || 1
  const x = (i) => pts.length === 1 ? W - PAD : PAD + (i * (W - 2 * PAD)) / (pts.length - 1)
  const y = (v) => H - PAD - ((v - min) * (H - 2 * PAD)) / span
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastX = x(pts.length - 1), lastY = y(pts[pts.length - 1])
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`熱度走勢 ${pts.map((p) => Math.round(p)).join('、')}`}>
      {pts.length > 1 && <path d={path} className="spark-line" fill="none" />}
      <circle cx={lastX} cy={lastY} r="4" className="spark-dot" />
    </svg>
  )
}

export function fmtHeat(n) {
  return Math.round(n).toLocaleString('en-US')
}

export function fmtDate(iso, weekday) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y} 年 ${m} 月 ${d} 日${weekday ? ` · 週${weekday}` : ''}`
}
