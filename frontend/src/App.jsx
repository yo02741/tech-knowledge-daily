import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndex, fetchReport } from './data.js'
import { StatusBadge, DeadlineChip, Sparkline, fmtHeat, fmtDate } from './bits.jsx'

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
          <a href="#/archive">歷期</a>
          <button className="theme-btn" onClick={cycleTheme}
                  title={`主題：${theme}`} aria-label="切換深淺色主題">{themeIcon}</button>
        </div>
      </nav>
      {children}
      <footer className="colophon">
        <span>tech-knowledge-daily — 熱度與狀態由管線計算，行動建議對照 PROFILE 產生</span>
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
