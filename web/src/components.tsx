import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import confetti from 'canvas-confetti'
import type { CategoryResult, FeedItem, PlayerStatus } from './api'
import { diffText, fmtPts, resultLabel, type MySide, type Res } from './matchups'
import { cpblTeam } from './teams'

export function TeamChip({ code }: { code: string | null | undefined }) {
  const t = cpblTeam(code)
  return (
    <span className="team-chip" style={{ background: t.bg, color: t.fg }} title={t.short}>
      {t.short}
    </span>
  )
}

const SILHOUETTE = (
  <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
    <circle cx="50" cy="34" r="17" />
    <path d="M14 104c2-28 18-44 36-44s34 16 36 44z" />
  </svg>
)

/** 球員頭像：背號 + 所屬球隊色圈。依規則書 10.2 不使用球員照片。 */
export function Avatar({ team, number, size }: { team: string | null | undefined; number: string | null | undefined; size?: 'lg' }) {
  const t = cpblTeam(team)
  return (
    <div className={`av ${size ?? ''}`} style={{ ['--tc' as string]: t.bg }}>
      {SILHOUETTE}
      <b>{number ?? ''}</b>
    </div>
  )
}

/** 等級頭像（設計稿 v6、球員卡 2c）：外圈依稀有度（傳奇全息、金、銀、銅）、內圈球隊色、中間背號。 */
export function TierAvatar({ team, number, tier, size }: {
  team: string | null | undefined
  number: string | null | undefined
  tier: Tier
  size?: 'sm' | 'lg'
}) {
  return (
    <div className={`tav ${tier} ${size ?? ''}`} style={{ ['--tc' as string]: cpblTeam(team).bg }}>
      <div>{number ?? ''}</div>
    </div>
  )
}

/** 卡片稀有度（球員卡規範）：傳奇、金卡、稀有、一般。名稱避開市售球卡品牌用語。 */
export type Tier = 'legend' | 'gold' | 'rare' | 'common'

/** 稀有度依當季排名自動決定、會升降級，純外觀：1–3 傳奇、4–10 金卡、11–30 稀有、31 以後一般。 */
export function tierOf(rank: number | null | undefined): Tier {
  if (rank == null || rank <= 0) return 'common'
  if (rank <= 3) return 'legend'
  if (rank <= 10) return 'gold'
  if (rank <= 30) return 'rare'
  return 'common'
}

export const TIER_LABEL: Record<Tier, string> = { legend: 'LEGEND', gold: 'GOLD', rare: 'RARE', common: 'COMMON' }
export const TIER_ZH: Record<Tier, string> = { legend: '傳奇', gold: '金卡', rare: '稀有', common: '一般' }

export function PlayerCard({ name, team, number, positions, line, tier, back }: {
  name: string
  team: string
  number: string | null
  positions: string
  line: string
  tier: Tier
  back: [string, string][]
}) {
  const [flipped, setFlipped] = useState(false)
  return (
    <button type="button" className={`pcard tier-${tier} ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)}
      style={{ ['--tc' as string]: cpblTeam(team).bg }} aria-label={`${name} 球員卡，點擊翻面`}>
      <div className="pcard-inner">
        <div className="face front">
          <div className="face-in">
            <div className="pc-top"><TeamChip code={team} /><span className="pc-tier">{TIER_LABEL[tier]}</span></div>
            <div className="pc-art">
              <svg className="pc-sil" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><circle cx="50" cy="30" r="16" /><path d="M18 100c2-26 16-42 32-42s30 16 32 42z" /></svg>
              <div className="pc-num">{number ?? ''}</div>
            </div>
            <div className="pc-foot"><div className="pc-name">{name}</div><div className="pc-pos">{positions}</div><div className="pc-line">{line}</div></div>
          </div>
        </div>
        <div className="face back">
          <div className="face-in">
            <div className="pc-name">{name} <span className="pc-pos">本季</span></div>
            <table><tbody>{back.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </button>
  )
}

/**
 * 小球員卡（設計稿樣式）：金屬框、格紋背號、等級字；點擊翻面看背面數據。
 * 用於本期關鍵卡、王牌對決、隊伍首頁卡冊；純外觀，不可交易或購買。
 * 傳入 onOpen 時改為「點擊開啟選單」（卡冊），不翻面。
 */
export function MiniCard({ name, team, number, slot, tier, line, back, backLabel, foot, onOpen, dot, live, tone }: {
  name: string
  team: string
  number: string | null
  slot: string
  tier: Tier
  line: string
  back?: [string, string][]
  backLabel?: string
  foot?: string
  onOpen?: () => void
  /** 右上角狀態燈顏色（二軍、未出賽） */
  dot?: string
  /** 比賽進行中：摘要前加紅點 */
  live?: boolean
  tone?: 'warn' | 'muted'
}) {
  const [flipped, setFlipped] = useState(false)
  return (
    <button type="button" className={`mcard ${tier} ${flipped ? 'flipped' : ''}`}
      onClick={onOpen ?? (() => setFlipped(!flipped))}
      style={{ ['--tc' as string]: cpblTeam(team).bg }} aria-label={onOpen ? `${name}，開啟調整選單` : `${name} 球員卡，點擊翻面`}>
      <div className="mcard-in">
        <div className="mcard-face">
          <div className="mcard-body">
            <div className="mcard-top"><span>{slot}</span><TeamChip code={team} /></div>
            <div className="mcard-art">
              <b>{number ?? ''}</b><small>{TIER_LABEL[tier]}</small>
              {dot && <span className="fdot" style={{ ['--dot' as string]: dot }} />}
            </div>
            <div className="mcard-name">{name}</div>
            <div className={`mcard-line ${tone ?? ''}`}>{live && <i className="ldot" />}{line}</div>
          </div>
        </div>
        <div className="mcard-face back">
          <div className="mcard-body">
            <div className="mcard-bname">{name}</div>
            <div className="mcard-blabel">{backLabel}</div>
            <div className="mcard-rows">{(back ?? []).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
            {foot && <div className="mcard-foot">{foot}</div>}
          </div>
        </div>
      </div>
    </button>
  )
}

// ---------- 票根（對戰頁 8a、隊伍首頁 v6 共用） ----------

const RES_CLASS: Record<Res, string> = { W: 'w', L: 'l', T: 't' }
/** 計分類別固定順序（同後端 Category） */
export const CATEGORY_ORDER = ['R', 'HR', 'H', 'BB', 'AVG', 'QS', 'K', 'W+SV', 'ERA', 'WHIP']
const CATEGORY_SHORT: Record<string, string> = { 'W+SV': 'WSV' }

/** 結果章：結束後為勝／敗／和，進行中為領先／落後／平手。 */
export function Stamp({ result, final, size, text }: { result: Res; final: boolean; size: 'lg' | 'sm'; text?: string }) {
  const word = text ?? (final ? { W: '勝', L: '敗', T: '和' } : { W: '領先', L: '落後', T: '平手' })[result]
  return <span className={`stamp ${size} ${text ? '' : RES_CLASS[result]} ${final ? 'final' : ''}`}>{word}</span>
}

/** 10 格類別條：我方領先金色、對手領先銀灰、平手或無數據暗色。 */
export function CatSegs({ cats, side, labels, tight }: { cats: CategoryResult[]; side: 'A' | 'B'; labels?: boolean; tight?: boolean }) {
  const byCat = new Map(cats.map((c) => [c.category, c]))
  return (
    <div className={`catsegs ${tight ? 'tight' : ''}`} aria-hidden="true">
      {CATEGORY_ORDER.map((k) => {
        const w = byCat.get(k)?.winner
        const cls = w === side ? 'me' : w === 'A' || w === 'B' ? 'op' : ''
        return <div key={k} className={cls}><i />{labels && <span>{CATEGORY_SHORT[k] ?? k}</span>}</div>
      })}
    </div>
  )
}

/**
 * 對戰票根。lg：對戰頁可左右滑的大票根（點擊切換下方類別）；sm：隊伍首頁並排的小票根（點擊進對戰頁）。
 * no 為本期第幾場（1 起算），rec 為對手戰績說明，color 為對手的 fantasy 隊伍色。
 */
export function MatchTicket({ v, no, size, rec, color, active, onClick }: {
  v: MySide
  no: number
  size: 'lg' | 'sm'
  rec?: string
  color?: string
  active?: boolean
  onClick?: () => void
}) {
  const no2 = String(no).padStart(2, '0')
  const pending = v.m.status === 'PENDING'
  const res = RES_CLASS[v.result]
  const stamp = <Stamp result={v.result} final={v.final} size={size} text={pending ? '未開始' : undefined} />
  const score = (
    <div className="tk-score"><span>{fmtPts(v.me)}</span><span className="colon">:</span><span className="op">{fmtPts(v.op)}</span></div>
  )
  if (size === 'lg') {
    return (
      <button type="button" className={`tk lg ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
        <div className="tk-main">
          <div className="tk-wm">{no2}</div>
          <div className="tk-kick"><b>TICKET</b> · MATCH {no2}{v.neighbour && ` · ${v.neighbour}`}</div>
          <div className="tk-name">vs {v.oppName ?? '待定'}</div>
          {rec && <div className="tk-rec">{rec}</div>}
          {score}
          <CatSegs cats={v.m.categories} side={v.side} labels />
        </div>
        <div className="tk-cut" />
        <div className="tk-stub">
          <small>RESULT</small>
          {stamp}
          <span className={`diff c-${pending ? 't' : res}`}>{pending ? '—' : diffText(v)}</span>
        </div>
        <span className="tk-notch t" />
        <span className="tk-notch b" />
      </button>
    )
  }
  return (
    <Link to={`/matchups/${v.m.id}`} className={`tk sm ${v.result === 'W' && !pending ? 'w' : ''}`}
      style={{ ['--tc' as string]: color }}>
      <div className="tk-sm-top">
        <div className="tk-sm-kick"><span>M{no2}{v.neighbour && ` · ${v.neighbour}`}</span><i /></div>
        <div className="tk-name">vs {v.oppName ?? '待定'}</div>
        {score}
        <div className={`tk-label c-${pending ? 't' : res}`}>{pending ? '尚未開始' : resultLabel(v)}</div>
      </div>
      <div className="tk-sm-cut" />
      <div className="tk-sm-bot"><CatSegs cats={v.m.categories} side={v.side} tight />{stamp}</div>
    </Link>
  )
}

/** 出賽狀態標示。只呈現事實描述，不推測原因（規則書 6.1.3）。 */
export function StatusBadge({ status }: { status: PlayerStatus | null | undefined }) {
  if (!status || status.code === 'ACTIVE') return null
  const cls = status.code === 'DELISTED' || status.code === 'IDLE' ? 'danger' : 'warn'
  return <span className={`badge ${cls}`}>{shortStatus(status)}</span>
}

export function shortStatus(s: PlayerStatus) {
  switch (s.code) {
    case 'MINORS': return '二軍'
    case 'DELISTED': return '已註銷'
    case 'IDLE': return s.text
    default: return ''
  }
}

export function PlayerLink({ id, name }: { id: number; name: string; leagueId?: number }) {
  return <Link to={`/players/${id}`}>{name}</Link>
}

export function Loading() {
  return <p className="muted" style={{ padding: '16px 0' }}>載入中…</p>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return <div className="alert error">{msg}</div>
}

export function BottomSheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={label}>{children}</div>
    </div>
  )
}

let toastTimer: number | undefined
export function toast(msg: string) {
  document.querySelectorAll('.toast').forEach((t) => t.remove())
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.remove(), 2200)
}

export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  confetti({ particleCount: 140, spread: 80, origin: { y: 0.55 }, colors: ['#f6e1a2', '#d8b25a', '#8d6a20', '#f3f5f8', '#c4cad4'] })
}

/** 簡易資料載入 hook。 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    loader()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

export function fmtDate(s: string | null | undefined) {
  if (!s) return ''
  const d = s.slice(0, 10).split('-')
  return `${Number(d[1])}/${Number(d[2])}`
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']
export function weekday(s: string) {
  return WEEK[new Date(s.slice(0, 10) + 'T00:00:00').getDay()]
}

export function fmtDateTime(s: string | null | undefined) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtTime(s: string | null | undefined) {
  if (!s) return ''
  return new Date(s).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' })
}

export const MATCHUP_STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '尚未開始', cls: '' },
  LIVE: { text: '進行中', cls: 'live' },
  PROVISIONAL: { text: '暫定結果', cls: 'warn' },
  LOCKED: { text: '已確定', cls: 'ok' },
}

const FEED_KIND: Record<FeedItem['kind'], string> = { HOT: '表現', MOVE: '異動', GAME: '賽程', LEAGUE: '聯盟' }

export function FeedRow({ item, onOpen }: { item: FeedItem; onOpen?: (playerId: number) => void }) {
  return (
    <button type="button" className="fitem" onClick={() => item.playerId && onOpen?.(item.playerId)} disabled={!item.playerId && !onOpen}
      style={{ opacity: 1, cursor: item.playerId ? 'pointer' : 'default' }}>
      {item.playerId ? <Avatar team={item.cpblTeam} number={item.jerseyNumber} />
        : <div className="feed-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 16a4 4 0 1 1 .5-7.97A6 6 0 0 1 19 9a4 4 0 0 1-1 7.9" /><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2" /></svg></div>}
      <div>
        <div className="t"><span className={`kind k-${item.kind}`}>{FEED_KIND[item.kind]}</span>{item.text}</div>
        <div className="when">{fmtDateTime(item.at)}</div>
      </div>
    </button>
  )
}

export function Footer() {
  return (
    <footer className="site">
      <p>
        私人、非商業、免費的封閉聯盟娛樂工具，與中華職業棒球大聯盟及各球團無隸屬或合作關係。
        不涉及任何金錢、獎品或可兌換價值；FAAB 為聯盟內部虛擬預算。
      </p>
      <p>
        統計數據取自中華職棒官網公開之客觀數據（僅統計欄位）。球隊以自訂色塊與縮寫呈現，球員以背號呈現，未使用官方標誌或照片。
        <Link to="/privacy"> 隱私權政策與資料來源</Link>
      </p>
    </footer>
  )
}

export const ICONS = {
  team: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11 12 4l9 7v9H3z" /><path d="M9 20v-6h6v6" /></svg>,
  matchup: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M12 5v14M7 10v4M17 10v4" /></svg>,
  players: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="12" height="16" rx="2" /><path d="M8 21h10a2 2 0 0 0 2-2V7" /></svg>,
  draft: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>,
  trophy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 5-7 7 7 7" /></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>,
  swap: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>,
  live: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  server: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /></svg>,
  standings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  star: <svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>,
}
