import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndex, fetchReport, fetchCloud } from './data.js'
import { STATUS, StatusBadge, DeadlineChip, Sparkline, fmtHeat, fmtDate } from './bits.jsx'

const DOMAINS = ['ai', 'software', 'devops', 'uiux']
const DOMAIN_META = {
  ai: { kicker: 'AI · LLM · AGENT', label: 'AI 趨勢' },
  software: { kicker: 'FRONTEND · BACKEND', label: '前後端' },
  devops: { kicker: 'DEVOPS', label: 'DevOps' },
  uiux: { kicker: 'UI · UX · DESIGN', label: 'UI/UX' },
}

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const h = hash.replace(/^#\/?/, '')
  if (h === 'archive') return { view: 'archive' }
  if (h === 'trends') return { view: 'trends' }
  if (h === 'tech') return { view: 'tech' }
  const m = /^(\d{4}-\d{2}-\d{2})(?:\/([a-z]+-\d+))?$/.exec(h)
  if (m) return { view: 'issue', date: m[1], anchor: m[2] || null }
  return { view: 'issue', date: null } // 最新一期
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  const cycle = () => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')
  return [theme, cycle]
}

export default function App() {
  const route = useHashRoute()
  const [theme, cycleTheme] = useTheme()
  const [index, setIndex] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchIndex().then(setIndex).catch((e) => setError(String(e)))
  }, [])

  if (error) return <Shell theme={theme} cycleTheme={cycleTheme}><p className="status-msg">讀取失敗：{error}</p></Shell>
  if (!index) return <Shell theme={theme} cycleTheme={cycleTheme}><p className="status-msg">載入中…</p></Shell>
  if (!index.length) return <Shell theme={theme} cycleTheme={cycleTheme}><p className="status-msg">還沒有任何一期報告。</p></Shell>

  return (
    <Shell theme={theme} cycleTheme={cycleTheme}>
      {route.view === 'archive'
        ? <Archive index={index} />
        : route.view === 'trends'
          ? <TrendsCloud />
          : route.view === 'tech'
            ? <TechPage index={index} />
            : <Issue index={index} date={route.date || index[0].date} anchor={route.anchor} />}
    </Shell>
  )
}

function Shell({ theme, cycleTheme, children }) {
  const themeIcon = theme === 'auto' ? '◐' : theme === 'dark' ? '☾' : '☀'
  return (
    <div className="page">
      <nav className="topnav">
        <a href="#/" className="brand">每日技術熱點</a>
        <div className="topnav-right">
          <a href="#/trends">趨勢</a>
          <a href="#/tech">一技</a>
          <a href="#/archive">歷期</a>
          <button className="theme-btn" onClick={cycleTheme}
                  title={`主題：${theme}`} aria-label="切換深淺色主題">{themeIcon}</button>
        </div>
      </nav>
      {children}
      <footer className="colophon">
        <span>tech-knowledge-daily — 每日自動抓取 HN / GitHub Trending / Reddit，熱度與狀態由管線計算</span>
      </footer>
      <BackToTop />
    </div>
  )
}

/* 滑超過一個視窗高度才出現，避免一開頁就佔角落 */
function BackToTop() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  if (!visible) return null
  return (
    <button className="back-to-top" aria-label="回到頂部" title="回到頂部"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <span className="btt-arrow" aria-hidden="true">↑</span>
      <span className="btt-label">回到頂部</span>
    </button>
  )
}

function Issue({ index, date, anchor }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [catalog, setCatalog] = useState('all')
  const [panel, setPanel] = useState(null) // null | 'tldr' | 'actions'
  useEffect(() => {
    setReport(null); setError(null)
    fetchReport(date).then(setReport).catch((e) => setError(String(e)))
  }, [date])

  // 深連結 #/<date>/<topic-id>：報告渲染完成後捲到該熱點
  useEffect(() => {
    if (report && anchor) document.getElementById(anchor)?.scrollIntoView()
  }, [report, anchor])

  const pos = index.findIndex((e) => e.date === date)
  const issueNo = pos >= 0 ? index.length - pos : null
  const newer = pos > 0 ? index[pos - 1].date : null
  const older = pos >= 0 && pos < index.length - 1 ? index[pos + 1].date : null

  if (error) return <p className="status-msg">讀取 {date} 失敗：{error}</p>
  if (!report) return <p className="status-msg">載入中…</p>

  const shown = catalog === 'all'
    ? DOMAINS.filter((d) => (report.sections[d] || []).length)
    : [catalog]

  return (
    <article className="issue">
      <header className="masthead">
        <p className="kicker">TECH KNOWLEDGE DAILY{issueNo ? ` · 第 ${issueNo} 期` : ''}</p>
        <h1>每日技術熱點</h1>
        <p className="dateline">{fmtDate(report.date, report.weekday)}</p>
        <div className="issue-tools">
          {report.tldr?.length > 0 && (
            <button className="tool-btn" title="本期要點" aria-label="本期要點"
                    onClick={() => setPanel('tldr')}>
              <FlameIcon />
            </button>
          )}
        </div>
      </header>

      {panel === 'tldr' && (
        <Drawer title="本期要點" onClose={() => setPanel(null)}>
          <ol className="drawer-tldr">
            {report.tldr.map((t, i) => (
              <TldrItem key={i} item={t} full onJump={() => setPanel(null)} />
            ))}
          </ol>
        </Drawer>
      )}

      <nav className="catalog" aria-label="分類切換">
        {[['all', '全部'], ...DOMAINS.map((d) => [d, DOMAIN_META[d].label])].map(([key, label]) => (
          <button key={key}
                  className={`catalog-tab${catalog === key ? ' active' : ''}`}
                  aria-pressed={catalog === key}
                  onClick={() => setCatalog(key)}>
            {label}
            {key !== 'all' && <sup className="catalog-count">{(report.sections[key] || []).length}</sup>}
          </button>
        ))}
      </nav>

      {/* key=catalog：切換分類時整塊 remount 觸發淡入 */}
      <div key={catalog} className="fade-swap">
        {shown.map((d) => (
          <section className="domain" key={d}>
            <header className="domain-head">
              <p className="kicker">{DOMAIN_META[d].kicker}</p>
            </header>
            {(report.sections[d] || []).length
              ? report.sections[d].map((t) => (
                  <Topic key={t.id} topic={t} template={report.generated === 'template'} />
                ))
              : <p className="domain-empty">今日無 {DOMAIN_META[d].label} 熱點——寧缺勿濫。</p>}
          </section>
        ))}
      </div>

      {report.radar?.length > 0 && (
        <section className="radar">
          <h2 className="section-label">雷達區</h2>
          <ul>
            {report.radar.map((r, i) => (
              <li key={i}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                <span className="radar-note">{r.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.data_quality?.length > 0 && (
        <section className="dq">
          <h2 className="section-label">資料品質</h2>
          <ul>
            {report.data_quality.map((q, i) => (
              <li key={i}><strong>{q.source}</strong>：{q.note}</li>
            ))}
          </ul>
        </section>
      )}

      <nav className="issue-nav">
        {older ? <a href={`#/${older}`}>← 前一期 {older}</a> : <span />}
        {newer ? <a href={`#/${newer}`}>後一期 {newer} →</a> : <span />}
      </nav>
    </article>
  )
}

/* 側邊抽屜：backdrop 點擊 / ESC 關閉，開啟時鎖 body 捲動 */
function Drawer({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    // 鎖捲動會讓 scrollbar 消失、內容右移抖動——補等寬 padding 抵銷
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }, [onClose])
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <h2 className="drawer-title">{title}</h2>
          <button className="drawer-close" onClick={onClose} aria-label="關閉">×</button>
        </header>
        {children}
      </aside>
    </>
  )
}

function FlameIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id="tkd-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#e34948" />
          <stop offset="55%" stopColor="#eb6834" />
          <stop offset="100%" stopColor="#eda100" />
        </linearGradient>
      </defs>
      <path stroke="url(#tkd-flame)"
            d="M12 10.941c2.333-3.308.167-7.823-1-8.941 0 3.395-2.235 5.299-3.667 6.706C5.903 10.114 5 12.327 5 14.294 5 17.998 8.134 21 12 21s7-3.002 7-6.706c0-1.712-1.232-4.403-2.333-5.588-2.084 3.353-3.257 3.353-4.667 2.235" />
    </svg>
  )
}

/* 舊報告的 tldr 只有 text；新 schema 是 title + text。
   title 可點擊捲動到對應 topic 段落（那裡有完整來源超連結）。
   full=true（抽屜內）直接顯示全文；否則一行截斷點擊展開。 */
function TldrItem({ item, full = false, onJump }) {
  const [open, setOpen] = useState(false)
  const expanded = full || open
  const jump = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onJump?.()
    document.getElementById(item.topic_ref)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const title = item.title || item.text
  const hasBody = Boolean(item.title && item.text)
  const toggleable = hasBody && !full
  return (
    <li className={toggleable ? 'expandable' : ''} onClick={() => toggleable && setOpen(!open)}>
      <div className="tldr-head">
        {item.topic_ref
          ? <a className="tldr-title" href={`#${item.topic_ref}`} onClick={jump}>{title}</a>
          : <span className="tldr-title">{title}</span>}
        {item.deadline && <DeadlineChip deadline={item.deadline} />}
        {toggleable && <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true">▾</span>}
      </div>
      {hasBody && (
        <p key={expanded ? 'open' : 'closed'}
           className={`tldr-text fade-swap${expanded ? '' : ' clamped'}`}>{item.text}</p>
      )}
    </li>
  )
}

function Topic({ topic }) {
  const trend = topic.heat_trend || []
  const prev = trend.length > 1 ? trend[trend.length - 2] : null
  return (
    <article className="topic" id={topic.id}>
      <h3 className="topic-title">{topic.title}</h3>
      <div className="topic-meta">
        <StatusBadge status={topic.status} />
        <span className="heat">
          熱度 <strong>{fmtHeat(topic.heat_today)}</strong>
          {prev !== null && <span className="heat-prev">（昨 {fmtHeat(prev)}）</span>}
        </span>
        <Sparkline trend={trend} />
      </div>
      <dl className="facets">
        <div><dt>是什麼</dt><dd>{topic.what}</dd></div>
        <div><dt>為何爆</dt><dd>{topic.why_hot}</dd></div>
      </dl>
      {topic.sources?.length > 0 && (
        <p className="sources">
          {topic.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="source-pill">{s.label}</a>
          ))}
        </p>
      )}
    </article>
  )
}

const CARD_DOMAIN = {
  ai: 'AI', frontend: '前端', backend: '後端', uiux: 'UI/UX', devops: 'DevOps',
}

/* 每日一技：題庫確定性輪播的技術小卡（嵌在當期報告的 tech_intro 欄位） */
function TechIntro({ card, bare = false }) {
  return (
    <section className="tech-intro">
      {!bare && <h2 className="section-label">每日一技 <span className="label-note">DAILY TECH 101</span></h2>}
      <article className="tech-card">
        <div className="tech-tags">
          <span className="wf-tag">{CARD_DOMAIN[card.domain] || card.domain}</span>
          {card.level && <span className="wf-tag">{card.level}</span>}
        </div>
        <h3 className="tech-term">{card.term}</h3>
        {card.tagline && <p className="tech-tagline">{card.tagline}</p>}
        {(card.intro || []).map((p, i) => <p className="tech-p" key={i}>{p}</p>)}
        {card.links?.length > 0 && (
          <p className="sources">
            {card.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer" className="source-pill">{l.label}</a>
            ))}
          </p>
        )}
      </article>
    </section>
  )
}

/* 每日一技獨立頁：今日卡片 + 往期回顧（各期報告的 tech_intro 就地取材） */
function TechPage({ index }) {
  const [cards, setCards] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    const dates = index.slice(0, 14).map((e) => e.date) // 最近 14 期就夠回顧
    Promise.all(dates.map((d) => fetchReport(d).catch(() => null)))
      .then((reports) => setCards(
        reports
          .map((r, i) => r?.tech_intro ? { date: dates[i], card: r.tech_intro } : null)
          .filter(Boolean)
      ))
      .catch((e) => setError(String(e)))
  }, [index])

  if (error) return <p className="status-msg">讀取失敗：{error}</p>
  if (!cards) return <p className="status-msg">載入中…</p>
  if (!cards.length) return <p className="status-msg">還沒有任何一技卡片。</p>

  const [today, ...past] = cards
  return (
    <section className="tech-page fade-swap">
      <header className="masthead">
        <p className="kicker">DAILY TECH 101</p>
        <h1>每日一技</h1>
        <p className="dateline">每天一個技術概念 · 五領域輪流 · {fmtDate(today.date)}</p>
      </header>

      <div className="tech-hero">
        <TechIntro card={today.card} bare />
      </div>

      {past.length > 0 && (
        <section className="tech-past">
          <h2 className="section-label">往期回顧</h2>
          <ul>
            {past.map(({ date, card }) => <PastTechRow key={date} date={date} card={card} />)}
          </ul>
        </section>
      )}
    </section>
  )
}

function PastTechRow({ date, card }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="past-tech expandable" onClick={() => setOpen(!open)}>
      <div className="past-tech-head">
        <span className="past-date">{date}</span>
        <span className="wf-tag">{CARD_DOMAIN[card.domain] || card.domain}</span>
        <span className="past-term">{card.term}</span>
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </div>
      <p className="tech-tagline">{card.tagline}</p>
      {open && (
        <div className="fade-swap" onClick={(e) => e.stopPropagation()}>
          {(card.intro || []).map((p, i) => <p className="tech-p" key={i}>{p}</p>)}
          {card.links?.length > 0 && (
            <p className="sources">
              {card.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="source-pill">{l.label}</a>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/* 確定性 PRNG（mulberry32）：以日期為種子，雲的排列每天固定、跨訪問一致 */
function seededShuffle(arr, seedStr) {
  let seed = 0
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return { shuffled: out, rand }
}

/* 經典文字雲排版：由大到小沿阿基米德螺旋找位、AABB 碰撞檢測、部分直排。
   canvas 量測字寬；同一天（同種子）版面固定。回傳含座標的 word 陣列。 */
function layoutCloud(items, seedStr, W, H) {
  const { rand } = seededShuffle([], seedStr)
  const ctx = document.createElement('canvas').getContext('2d')
  const weights = items.map((i) => i.weight)
  const wMin = Math.min(...weights), wMax = Math.max(...weights)
  const fontSize = (w) => {
    if (wMax === wMin) return 46
    const t = (Math.log(w + 1) - Math.log(wMin + 1)) / (Math.log(wMax + 1) - Math.log(wMin + 1))
    return 17 + t * (66 - 17)
  }
  const placed = []
  const words = []
  const sorted = [...items].sort((a, b) => b.weight - a.weight)
  for (const it of sorted) {
    const fs = fontSize(it.weight)
    ctx.font = `700 ${fs}px Georgia, "Noto Serif TC", serif`
    const tw = ctx.measureText(it.label).width
    const th = fs * 1.08
    const vertical = words.length > 0 && it.label.length <= 12 && rand() < 0.4
    const bw = (vertical ? th : tw) + 8
    const bh = (vertical ? tw : th) + 6
    const angle0 = rand() * Math.PI * 2
    let pos = null
    for (let step = 0; step < 3000 && !pos; step++) {
      const t = step * 0.3
      const r = 1.8 * t * 0.28
      const x = W / 2 + r * Math.cos(t + angle0)
      const y = H / 2 + r * 0.62 * Math.sin(t + angle0) // 壓成橢圓貼合畫布比例
      if (x - bw / 2 < 2 || x + bw / 2 > W - 2 || y - bh / 2 < 2 || y + bh / 2 > H - 2) continue
      const hit = placed.some((p) =>
        Math.abs(x - p.x) < (bw + p.bw) / 2 && Math.abs(y - p.y) < (bh + p.bh) / 2)
      if (!hit) pos = { x, y }
    }
    if (!pos) continue // 擠不進畫布的小字放棄（排行榜仍列出）
    placed.push({ ...pos, bw, bh })
    words.push({ ...it, ...pos, fs, vertical })
  }
  return words
}

function TrendsCloud() {
  const [cloud, setCloud] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    fetchCloud().then(setCloud).catch((e) => setError(String(e)))
  }, [])

  const W = 700, H = 430
  const words = useMemo(
    () => cloud ? layoutCloud(cloud.items, cloud.date, W, H) : [],
    [cloud])

  if (error) return <p className="status-msg">讀取趨勢雲失敗：{error}</p>
  if (!cloud) return <p className="status-msg">載入中…</p>
  if (!cloud.items.length) return <p className="status-msg">趨勢雲還沒有資料——ledger 需要累積幾天熱度。</p>

  return (
    <section className="trends fade-swap">
      <header className="masthead">
        <p className="kicker">TREND CLOUD · 近 {cloud.window_days} 天</p>
        <h1>趨勢雲</h1>
        <p className="dateline">統計至 {fmtDate(cloud.date)} · 字越大，近期越火</p>
      </header>

      <svg className="cloud-svg" viewBox={`0 0 ${W} ${H}`} role="list"
           aria-label="近期趨勢文字雲">
        {words.map((w) => {
          const stale = w.last_seen !== cloud.date
          return (
            <a key={w.slug} href={`#/${w.last_seen}`} role="listitem">
              <text x={w.x} y={w.y}
                    textAnchor="middle" dominantBaseline="middle"
                    className={`cw-${w.status}${stale ? ' cw-stale' : ''}`}
                    fontSize={w.fs}
                    transform={w.vertical ? `rotate(90 ${w.x.toFixed(1)} ${w.y.toFixed(1)})` : undefined}>
                {w.label}
                <title>{`${w.display}｜近${cloud.window_days}天熱度 ${fmtHeat(w.weight)}｜最近出現 ${w.last_seen}`}</title>
              </text>
            </a>
          )
        })}
      </svg>

      <div className="cloud-legend">
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} className={`badge st-${key}`}>
            <span className="badge-icon" aria-hidden="true">{s.icon}</span>{s.label}
          </span>
        ))}
        <span className="legend-note">點字跳到該話題最近出現的一期</span>
      </div>

      <section className="cloud-rank">
        <h2 className="section-label">熱度排行</h2>
        <ol>
          {cloud.items.slice(0, 20).map((it, i) => (
            <li key={it.slug}>
              <span className="rank-no">{i + 1}</span>
              <a href={`#/${it.last_seen}`}>{it.display}</a>
              <StatusBadge status={it.status} />
              <span className="rank-heat">{fmtHeat(it.weight)}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}

function Archive({ index }) {
  return (
    <section className="archive">
      <header className="masthead">
        <p className="kicker">ARCHIVE</p>
        <h1>歷期目錄</h1>
      </header>
      <ul className="archive-list">
        {index.map((e, pos) => (
          <li key={e.date}>
            <a href={`#/${e.date}`} className="archive-row">
              <span className="archive-no">第 {index.length - pos} 期</span>
              <span className="archive-date">{e.date}{e.weekday ? `（${e.weekday}）` : ''}</span>
              <span className="archive-top">{e.top_topic}</span>
              <span className="archive-counts">{e.topic_count} 熱點</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
