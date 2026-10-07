import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { useApp } from '../App'
import { api, type BoardPlayer as ApiBoardPlayer, type DraftBoard as ApiDraftBoard, type DraftPick, type DraftReport,
  type DraftStats, type DraftView } from '../api'
import { BottomSheet, ErrorBox, TIER_LABEL, tierOf, useLoad } from '../components'
import { useServerNow, useWide } from '../hooks'
import { cpblTeam, fantasyTeamColor } from '../teams'
import { Medal } from './KeeperPage'

/**
 * 選秀室 v3（設計稿「選秀室 v3」3a 網頁、3b 手機）。與設計稿的差異見 docs/decisions.md「介面與設計稿」：
 * 輪數照聯盟設定、10 類別用聯盟的類別、缺位照名單結構、「ADP」改為「排名」、不做快轉（託管見 E18）。
 */

/** 順位標籤：輪.輪內順位（例 1.03） */
export function pickLabel(pickNo: number, teams: number) {
  const r = Math.floor((pickNo - 1) / teams) + 1
  const i = ((pickNo - 1) % teams) + 1
  return `${r}.${String(i).padStart(2, '0')}`
}

/** 輪流選的順位（keeper 不佔輪次，不列入） */
export function draftSlots(draft: DraftView): DraftPick[] {
  return draft.picks.filter((p) => !p.keeper).sort((a, b) => a.pickNo - b.pickNo)
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** 開始前的倒數：一小時以上顯示「x 時」，以內顯示 分:秒 */
const fmtCountdown = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} 時` : fmtClock(s))
const fmtHm = (iso: string) => new Date(iso).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })

// ------------------------------------------------------------------
// 音效與震動（設計稿：可關閉，偏好只存在這台裝置）
// ------------------------------------------------------------------

const SOUND_KEY = 'cpblf.draft.sound'
function soundOn() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}
let audio: AudioContext | null = null
function unlockAudio() {
  try {
    audio = audio ?? new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch { /* 不支援就略過 */ }
}
function beep(freqs: number[], dur: number, gap: number, type: OscillatorType, vol: number) {
  if (!soundOn()) return
  try {
    unlockAudio()
    const ctx = audio!
    const t0 = ctx.currentTime + 0.02
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * gap
      o.type = type
      o.frequency.value = f
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(t)
      o.stop(t + dur + 0.03)
    })
  } catch { /* 不支援就略過 */ }
}
function buzz(p: number | number[]) {
  try { if (soundOn() && navigator.vibrate) navigator.vibrate(p) } catch { /* 不支援就略過 */ }
}
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 計時票根、標題、上一個選擇與接下來的順位橫條。 */
export function RoomHeader({ draft, queueLen = 0, onReport, onChange }: { draft: DraftView; queueLen?: number; onReport?: () => void; onChange?: () => void }) {
  const { leagueId, league, system } = useApp()
  // 託管（E18）：輪到就在 3 秒內照候選 → 補缺位 → 排名自動選
  const auto = (id: number | null | undefined) => id != null && draft.autopilotTeams.includes(id)
  const myAuto = auto(league?.myTeamId)
  const toggleAuto = async () => {
    if (league?.myTeamId == null) return
    await api.put(`/api/leagues/${leagueId}/drafts/${draft.id}/autopilot`, { teamId: league.myTeamId, on: !myAuto })
    onChange?.()
  }
  const wide = useWide()
  const now = useServerNow(250)
  const teams = league?.teams ?? []
  const n = draft.order.length || teams.length || 1
  const slots = draftSlots(draft)
  const done = draft.status === 'COMPLETED'
  const live = draft.status === 'IN_PROGRESS'
  const paused = draft.status === 'PAUSED'
  // 還沒開始（選秀室開放、揭曉後）：倒數到選秀時間 T，時間到自動開始
  const pre = !live && !paused && !done
  const startLeft = draft.scheduledAt ? Math.max(0, Math.ceil((Date.parse(draft.scheduledAt) - now) / 1000)) : null
  const team = teams.find((t) => t.id === draft.currentTeamId)
  const mine = live && draft.currentTeamId === league?.myTeamId
  // 暫停時倒數停住（後端給暫停當下剩下的秒數）
  const rem = draft.deadline && !paused ? Math.max(0, Math.ceil((Date.parse(draft.deadline) - now) / 1000)) : draft.secondsLeft
  const urgent = mine && rem <= 10
  const cur = slots.find((p) => p.pickNo === draft.currentPickNo)
  const nextMe = slots.find((p) => p.teamId === league?.myTeamId && p.pickNo >= draft.currentPickNo && !p.playerId)
  const last = slots.filter((p) => p.playerId).slice(-1)[0]
  const color = (id: number) => fantasyTeamColor(id, teams)
  const short = (id: number) => teams.find((t) => t.id === id)?.name ?? ''

  const state = done ? 'done' : urgent ? 'urgent' : mine ? 'mine' : 'idle'
  const label = cur ? pickLabel(cur.pickNo, n) : '—'
  const note = done ? '看成績單 ›'
    : paused ? '暫停中，等管理員繼續'
      : pre ? (draft.revealedAt ? '順位已揭曉・時間到自動開始' : draft.keeperDeadline ? `${fmtHm(draft.keeperDeadline)} 自動揭曉順位` : '等管理員設定選秀時間')
      : mine ? (myAuto ? '託管中・3 秒內自動選' : queueLen > 0 ? '時間到選候選第 1 位' : '時間到自動補缺位')
        : nextMe ? `再 ${nextMe.pickNo - draft.currentPickNo} 順位輪到你（${pickLabel(nextMe.pickNo, n)}）` : '你已選完'

  const idx = cur ? slots.indexOf(cur) : slots.length
  const strip = slots.slice(Math.max(0, idx - 3), Math.min(slots.length, idx + (wide ? 8 : 7)))

  // 輪到你：橫幅、三連音、震動；最後 5 秒每秒嗶一聲
  const [sound, setSound] = useState(soundOn)
  const [banner, setBanner] = useState(false)
  const wasMine = useRef(mine)
  const lastTick = useRef(0)
  useEffect(() => {
    document.addEventListener('pointerdown', unlockAudio)
    return () => document.removeEventListener('pointerdown', unlockAudio)
  }, [])
  useEffect(() => {
    if (mine && !wasMine.current) {
      buzz([140, 70, 140])
      beep([784, 1047, 1319], 0.26, 0.12, 'triangle', 0.2)
      setBanner(true)
      const t = setTimeout(() => setBanner(false), 2800)
      wasMine.current = mine
      return () => clearTimeout(t)
    }
    wasMine.current = mine
  }, [mine])
  useEffect(() => {
    if (mine && rem <= 5 && rem > 0 && rem !== lastTick.current) {
      lastTick.current = rem
      beep([1480], 0.06, 0.1, 'square', 0.045)
      buzz(30)
    }
  }, [mine, rem])
  const toggleSound = () => {
    const on = !sound
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* 無法儲存就只在這次有效 */ }
    setSound(on)
    if (on) beep([880], 0.1, 0.1, 'triangle', 0.14)
  }

  return (
    <div className="dr-head">
      <div className={`dr-banner${banner ? ' on' : ''}`} aria-live="polite">
        <div><i /><b>輪到你了</b><span>PICK {label} · {draft.pickSeconds} 秒</span></div>
      </div>
      <div className={`dr-ticket ${state}`}>
        <div className="in">
          <div className="top">
            <div className="k">
              <span className="kc">{done ? '完成' : paused ? 'PAUSED' : pre ? 'STARTS IN' : 'ON THE CLOCK'}</span>
              {!done && ` · ${paused ? '暫停中' : pre ? '選秀開始倒數' : mine ? '輪到你' : `${team?.name ?? ''}選擇中`}`}
            </div>
            <span>ROUND {done ? draft.rounds : cur?.round ?? 1} / {draft.rounds}</span>
          </div>
          <div className="mid">
            <div className="who">
              <i style={{ background: done ? 'var(--gold)' : team ? color(team.id) : 'var(--line-2)' }} />
              <b>{done ? '選秀結束' : pre ? (draft.scheduledAt ? `${fmtHm(draft.scheduledAt)} 開始` : '選秀時間未定') : team?.name ?? '—'}</b>
              <small>{done ? `${slots.length} 個順位全部選完`
                : pre ? '現在可以先排候選清單'
                  : paused ? '管理員暫停中'
                    : team ? `${team.owner}・${auto(team.id) ? '託管・3 秒內自動選' : mine ? '選一位球員' : '思考中…'}` : ''}</small>
            </div>
            <div className="time">{done ? '0:00' : pre ? (startLeft == null ? '—' : fmtCountdown(startLeft)) : fmtClock(rem)}</div>
          </div>
          <div className="bar"><i style={{ width: live || paused ? `${Math.min(100, (rem / draft.pickSeconds) * 100)}%` : '0%' }} /></div>
        </div>
        <div className="tear" />
        <div className={`foot${done && onReport ? ' go' : ''}`} onClick={done ? onReport : undefined}>
          <span>{done ? `${slots.length} PICKS · FINAL` : `PICK ${label} · 第 ${draft.currentPickNo} 順位`}</span>
          <span className="note">{note}</span>
        </div>
      </div>

      <div className="dr-side">
        <div className="dr-title">
          <span className="eb">DRAFT ROOM</span><b>選秀室</b>
          <span className="meta">{system?.seasonYear} · {draft.snake ? 'SNAKE' : '每輪同順序'} · {n} TEAMS · {draft.rounds} ROUNDS</span>
          <button type="button" className={`dr-sound${sound ? ' on' : ''}`} onClick={toggleSound} aria-pressed={sound}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M4 9v6h4l5 4V5L8 9z" /><path d={sound ? 'M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11' : 'M16 9l5 6M21 9l-5 6'} />
            </svg>
            音效 {sound ? '開' : '關'}
          </button>
          {!done && league?.myTeamId != null && (
            <button type="button" className={`dr-sound dr-auto${myAuto ? ' on' : ''}`} onClick={toggleAuto} aria-pressed={myAuto}
              title="開啟後輪到你就在 3 秒內自動選：候選清單 → 補缺位 → 排名">
              託管 {myAuto ? '開' : '關'}
            </button>
          )}
        </div>
        <div className="dr-last">
          <span className="eb">LAST PICK</span>
          {last ? <><i style={{ background: color(last.teamId) }} /><span>{pickLabel(last.pickNo, n)} {short(last.teamId)} → {last.playerName}{last.playerPosition ? `（${last.playerPosition}）` : ''}{last.auto ? '・自動' : ''}</span></> : <span>—</span>}
        </div>
        <div className="dr-strip">
          {strip.map((p) => {
            const now_ = p.pickNo === draft.currentPickNo && live
            const me = p.teamId === league?.myTeamId
            return (
              <div key={p.pickNo} className={`s${now_ ? ' cur' : ''}${me ? ' me' : ''}${p.playerId ? ' done' : ''}`}>
                <div className="l"><span>{pickLabel(p.pickNo, n)}</span><i style={{ background: color(p.teamId) }} /></div>
                <div className="t">{short(p.teamId)}</div>
                <div className="p">{p.playerName ?? (now_ ? '選擇中' : auto(p.teamId) ? '託管' : '—')}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 候選清單（GET／PUT …/queue）：網頁與手機同步；被選走的由後端排除
// ------------------------------------------------------------------

export interface DraftQueue {
  ids: number[]
  toggle: (playerId: number) => void
  remove: (playerId: number) => void
}

/** 每次選秀資料更新（輪詢）時重新讀取；送出中的修改不會被舊資料蓋掉 */
export function useDraftQueue(draft: DraftView): DraftQueue {
  const { leagueId } = useApp()
  const url = `/api/leagues/${leagueId}/drafts/${draft.id}/queue`
  const [ids, setIds] = useState<number[]>([])
  const pending = useRef(0)
  useEffect(() => {
    if (draft.status === 'COMPLETED') return
    api.get<number[]>(url).then((q) => { if (pending.current === 0) setIds(q) }).catch(() => undefined)
  }, [url, draft])
  const save = useCallback((next: number[]) => {
    setIds(next)
    pending.current++
    api.put<number[]>(url, { playerIds: next }).then(setIds).catch(() => undefined).finally(() => { pending.current-- })
  }, [url])
  return {
    ids,
    toggle: (id) => save(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    remove: (id) => save(ids.filter((x) => x !== id)),
  }
}

// ------------------------------------------------------------------
// 可選球員表
// ------------------------------------------------------------------

export type Cat = 'R' | 'HR' | 'H' | 'BB' | 'AVG' | 'QS' | 'K' | 'W+SV' | 'ERA' | 'WHIP'
export const HIT: Cat[] = ['R', 'HR', 'H', 'BB', 'AVG']
export const PIT: Cat[] = ['QS', 'K', 'W+SV', 'ERA', 'WHIP']
const LOW = new Set<Cat>(['ERA', 'WHIP'])

export function statOf(s: DraftStats, c: Cat): number | null {
  switch (c) {
    case 'R': return s.r
    case 'HR': return s.hr
    case 'H': return s.h
    case 'BB': return s.bb
    case 'AVG': return s.avg
    case 'QS': return s.qs
    case 'K': return s.k
    case 'W+SV': return s.wsv
    case 'ERA': return s.era
    case 'WHIP': return s.whip
  }
}

export function fmtStat(c: string, v: number | null | undefined) {
  if (v == null) return '–'
  if (c === 'AVG') return v.toFixed(3).replace(/^0/, '')
  if (c === 'ERA' || c === 'WHIP') return v.toFixed(2)
  return String(Math.round(v))
}

const isSp = (p: BoardPlayer) => p.eligible.includes('SP')

/** 候選清單、球員卡的一行重點數據 */
export function keyLine(p: BoardPlayer) {
  const s = p.stats
  if (!p.pitcher) return `${fmtStat('AVG', s.avg)} · ${s.hr} HR`
  return isSp(p) ? `${fmtStat('ERA', s.era)} · ${s.k} K` : `${fmtStat('ERA', s.era)} · ${s.wsv} W+SV`
}

const CHIPS: [string, string][] = [['NEED', '缺位'], ['ALL', '全部'], ['H', '打者'], ['P', '投手'], ['IF', 'IF'], ['OF', 'OF'], ['SP', 'SP'], ['RP', 'RP']]
/** 每頁人數（設計稿更新版：分頁取代「前 40 位」） */
const PAGE = 25

/** 頁碼：總頁數不超過格數就全列，否則用「…」省略（網頁 7 格、手機 5 格，同設計稿） */
function pageSeq(total: number, cur: number, slots: 5 | 7): (number | '…')[] {
  const rg = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  if (total <= slots) return rg(1, total)
  if (slots === 5) return cur <= 2 ? [1, 2, 3, '…', total] : cur >= total - 1 ? [1, '…', total - 2, total - 1, total] : [1, '…', cur, '…', total]
  return cur <= 4 ? [1, 2, 3, 4, 5, '…', total] : cur >= total - 3 ? [1, '…', ...rg(total - 4, total)] : [1, '…', cur - 1, cur, cur + 1, '…', total]
}

function Pager({ total, page, onPage, wide }: { total: number; page: number; onPage: (n: number) => void; wide: boolean }) {
  const pages = Math.max(1, Math.ceil(total / PAGE))
  if (pages <= 1) return null
  const from = (page - 1) * PAGE + 1, to = Math.min(total, page * PAGE)
  const info = <span className="info">第 {from}–{to} 位・共 {total} 位</span>
  return (
    <div className={`dr-pager${wide ? ' w' : ''}`}>
      {wide && info}
      <div className="btns">
        <button type="button" aria-label="上一頁" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m15 5-7 7 7 7" /></svg>
        </button>
        {pageSeq(pages, page, wide ? 7 : 5).map((n, i) => n === '…'
          ? <span key={`e${i}`} className="gap">…</span>
          : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
        <button type="button" aria-label="下一頁" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </div>
      {!wide && info}
    </div>
  )
}

export function PlayerList({ draft, board, queue, myTurn, onPick, selId, onSelect }: {
  draft: DraftView
  board: DraftBoard | null
  queue: DraftQueue
  myTurn: boolean
  onPick: (p: BoardPlayer) => void
  selId: number | null
  onSelect: (p: BoardPlayer) => void
}) {
  const wide = useWide()
  const [q, setQ] = useState('')
  const [chip, setChip] = useState('ALL')
  const [sort, setSort] = useState<Cat | 'RANK'>('RANK')
  const grp = ['H', 'IF', 'OF'].includes(chip) ? 'H' : ['P', 'SP', 'RP'].includes(chip) ? 'P' : null
  const cats = grp === 'P' ? PIT : HIT
  const sortBy: Cat | 'RANK' = grp && (grp === 'H' ? HIT : PIT).includes(sort as Cat) ? (sort as Cat) : 'RANK'

  const rows = useMemo(() => {
    let L = board?.players ?? []
    if (chip === 'NEED') L = L.filter((p) => p.fillsNeed)
    else if (chip === 'H') L = L.filter((p) => !p.pitcher)
    else if (chip === 'P') L = L.filter((p) => p.pitcher)
    else if (chip !== 'ALL') L = L.filter((p) => p.eligible.includes(chip))
    const t = q.trim()
    if (t) L = L.filter((p) => `${p.name}${cpblTeam(p.cpblTeam).short}${p.position}`.includes(t))
    if (sortBy !== 'RANK') {
      const v = (p: BoardPlayer) => statOf(p.stats, sortBy)
      L = [...L].sort((a, b) => {
        const x = v(a), y = v(b)
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
        return LOW.has(sortBy) ? x - y : y - x
      })
    }
    return L
  }, [board, chip, q, sortBy])

  // 分頁：篩選、排序、搜尋改變時回第 1 頁；被選走使總數變少時不超過最後一頁
  const [pageWant, setPageWant] = useState(1)
  useEffect(() => setPageWant(1), [chip, q, sortBy])
  const page = Math.min(pageWant, Math.max(1, Math.ceil(rows.length / PAGE)))
  const top = useRef<HTMLDivElement>(null)
  const goPage = (n: number) => {
    setPageWant(n)
    // 換頁後捲回列表頂端（手機扣掉黏在上方的分頁列）
    const el = top.current
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - (wide ? 12 : 64)
    if (window.scrollY > y) window.scrollTo({ top: y })
  }
  const count = `${rows.length} 位`
  return (
    <div className="dr-list" ref={top}>
      <div className="tools">
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋球員、中職球隊、守位" aria-label="搜尋球員" />
        </label>
        {wide && <span className="count">{count}</span>}
      </div>
      <div className="chips">
        {CHIPS.map(([v, t]) => <button key={v} type="button" aria-pressed={chip === v} onClick={() => setChip(chip === v && v !== 'ALL' ? 'ALL' : v)}>{t}</button>)}
      </div>
      <div className="sorts">
        <span className="lab">排序</span>
        <button type="button" className={sortBy === 'RANK' ? 'on' : ''} onClick={() => setSort('RANK')}>排名</button>
        {grp && cats.map((c) => <button key={c} type="button" className={sortBy === c ? 'on' : ''} onClick={() => setSort(c)}>{c}</button>)}
        <span className="basis">{board ? `數據：${board.basis}` : ''}</span>
        {!wide && <span className="count">{count}</span>}
      </div>
      {wide && (
        <div className="dr-row hd">
          <span className="rk">排名</span><span>球員</span><span>守位</span>
          {cats.map((c, i) => grp
            ? <button key={c} type="button" className={`v${sortBy === c ? ' on' : ''}`} onClick={() => setSort(sortBy === c ? 'RANK' : c)}>{c}</button>
            : <span key={c} className="v">{HIT[i]}/{PIT[i]}</span>)}
          <span className="c">候選</span><span />
        </div>
      )}
      {rows.slice((page - 1) * PAGE, page * PAGE).map((p) => {
        const t = cpblTeam(p.cpblTeam)
        const inQ = queue.ids.includes(p.playerId)
        const keys: Cat[] = !p.pitcher ? ['AVG', 'HR', 'R'] : isSp(p) ? ['ERA', 'K', 'QS'] : ['ERA', 'W+SV', 'K']
        if (sortBy !== 'RANK' && !keys.includes(sortBy)) keys[2] = sortBy
        return (
          <div key={p.playerId} className={`dr-row${p.recommended ? ' rec' : ''}${selId === p.playerId ? ' sel' : ''}`} onClick={() => onSelect(p)}>
            <span className="rk">{p.rank ?? '–'}</span>
            <span className="who">
              <Medal rank={p.rank} jersey={p.jerseyNumber} team={p.cpblTeam} size={wide ? 30 : 36} />
              <span className="nm">
                <span className="l1"><b>{p.name}</b><i className="tc" style={{ background: t.bg, color: t.fg }}>{t.short}</i>{p.foreign && <i className="tag">洋</i>}{p.recommended && <i className="tag gold">推薦</i>}</span>
                {!wide && (
                  <span className="l2">
                    <em className={p.fillsNeed ? 'need' : ''}>{p.position}</em>
                    {keys.map((c) => <span key={c} className={sortBy === c ? 'on' : ''}><b>{fmtStat(c, statOf(p.stats, c))}</b>{c}</span>)}
                  </span>
                )}
              </span>
            </span>
            {wide && <span className={`pos${p.fillsNeed ? ' need' : ''}`}>{p.position}</span>}
            {wide && (p.pitcher ? PIT : HIT).map((c) => <span key={c} className={`v${sortBy === c ? ' on' : ''}`}>{fmtStat(c, statOf(p.stats, c))}</span>)}
            <button type="button" className={`star${inQ ? ' on' : ''}`} aria-label={inQ ? '移出候選' : '加入候選'} onClick={(e) => { e.stopPropagation(); queue.toggle(p.playerId) }}>{inQ ? '★' : '☆'}</button>
            <span className="act">{myTurn && <button type="button" className="dr-pick" onClick={(e) => { e.stopPropagation(); onPick(p) }}>選</button>}</span>
          </div>
        )
      })}
      <Pager total={rows.length} page={page} onPage={goPage} wide={wide} />
      {board && rows.length === 0 && <div className="dr-empty">沒有符合的球員</div>}
      {!board && <div className="dr-empty">載入中…</div>}
      {draft.status !== 'IN_PROGRESS' && board && <p className="dr-hint">選秀開始後才能選人；現在可以先按 ☆ 排候選清單。</p>}
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀板：輪 × 隊伍（照揭曉的順位）；蛇形雙數輪反向，補強選秀每輪同順序
// ------------------------------------------------------------------

export function DraftGrid({ draft }: { draft: DraftView }) {
  const { league } = useApp()
  const wide = useWide()
  const teams = league?.teams ?? []
  const n = draft.order.length || 1
  const at = new Map(draftSlots(draft).map((p) => [`${p.round}-${p.teamId}`, p]))
  const live = draft.status === 'IN_PROGRESS'
  const cols = { gridTemplateColumns: `${wide ? 44 : 22}px repeat(${n}, minmax(0, 1fr))` }
  return (
    <div className="dr-grid">
      <div className="hd" style={cols}>
        <span />
        {draft.order.map((id) => {
          const t = teams.find((x) => x.id === id)
          return (
            <div key={id} className={id === league?.myTeamId ? 'me' : ''}>
              <i style={{ background: fantasyTeamColor(id, teams) }} />
              <span><b>{t?.name}</b>{wide && <small>{t?.owner}</small>}</span>
            </div>
          )
        })}
      </div>
      {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((r) => {
        const back = draft.snake && r % 2 === 0
        return (
          <div key={r} className="r" style={cols}>
            <div className="rn">R{r}<span>{back ? '←' : '→'}</span></div>
            {draft.order.map((id) => {
              const p = at.get(`${r}-${id}`)
              const cur = live && p?.pickNo === draft.currentPickNo
              const t = p?.playerTeam ? cpblTeam(p.playerTeam) : null
              return (
                <div key={id} className={`c${p?.playerId ? ' done' : ''}${cur ? ' cur' : ''}${id === league?.myTeamId ? ' me' : ''}`}>
                  <span className="nm">{p?.playerName ?? (cur ? '選擇中' : '')}</span>
                  <span className="ft">
                    <span>{p?.playerPosition ?? ''}</span>
                    {wide && t && <i style={{ background: t.bg, color: t.fg }}>{t.short}</i>}
                    {p?.auto && <em>自動</em>}
                    <span className="no">{p ? pickLabel(p.pickNo, n) : ''}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** 選秀室資料（可選球員、缺位）：每個順位結束後重新讀取 */
export function useDraftBoard(draft: DraftView) {
  const { leagueId } = useApp()
  return useLoad(() => api.get<ApiDraftBoard>(`/api/leagues/${leagueId}/drafts/${draft.id}/board`).then(toRoomBoard),
    [leagueId, draft.id, draft.currentPickNo, draft.status])
}

// 過渡：API 已改成各期間數據並含已選球員；畫面跟上新設計稿（期間下拉、顯示已選）前，先用預設期間、只列可選
type BoardPlayer = Omit<ApiBoardPlayer, 'stats'> & { stats: DraftStats }
type DraftBoard = Omit<ApiDraftBoard, 'players'> & { players: BoardPlayer[] }
const NO_STATS: DraftStats = {
  g: 0, pa: 0, ab: 0, h: 0, r: 0, hr: 0, bb: 0, avg: null,
  pg: 0, gs: 0, outs: 0, w: 0, sv: 0, wsv: 0, qs: 0, k: 0, ph: 0, pbb: 0, era: null, whip: null,
}
function toRoomBoard(b: ApiDraftBoard): DraftBoard {
  return { ...b, players: b.players.filter((p) => !p.taken).map((p) => ({ ...p, stats: p.stats[b.defaultPeriod] ?? NO_STATS })) }
}

// ------------------------------------------------------------------
// 球員卡、先發缺位、候選清單、我的陣容
// ------------------------------------------------------------------

function PlayerPanel({ p, basis, inQ, onToggle, pickText, canPick, onPick }: {
  p: BoardPlayer; basis: string; inQ: boolean; onToggle: () => void; pickText: string; canPick: boolean; onPick: () => void
}) {
  const t = cpblTeam(p.cpblTeam)
  const tier = tierOf(p.rank)
  return (
    <div className={`dr-card t-${tier}`}>
      <div className="in" style={{ background: `linear-gradient(165deg, ${t.bg}33 0%, ${t.bg}12 42%, transparent 72%), var(--surface)` }}>
        <div className="top"><span>PLAYER CARD</span><span className="ink">排名 {p.rank ?? '–'} · {TIER_LABEL[tier]}</span></div>
        <div className="id">
          <Medal rank={p.rank} jersey={p.jerseyNumber} team={p.cpblTeam} size={56} />
          <div>
            <div className="l1"><b>{p.name}</b><i style={{ background: t.bg, color: t.fg }}>{t.short}</i>{p.foreign && <i className="tag">洋</i>}</div>
            <div className={`pos${p.fillsNeed ? ' need' : ''}`}>{p.eligible.join('・')}{p.fillsNeed ? '・補先發缺位' : ''}</div>
            <div className="basis">{basis} · {keyLine(p)}</div>
          </div>
        </div>
        <div className="stats">
          {(p.pitcher ? PIT : HIT).map((c) => <div key={c}><small>{c}</small><b>{fmtStat(c, statOf(p.stats, c))}</b></div>)}
        </div>
        <div className="btns">
          <button type="button" className={`q${inQ ? ' on' : ''}`} onClick={onToggle}>{inQ ? '★ 候選中' : '☆ 候選'}</button>
          <button type="button" className={`p${canPick ? ' on' : ''}`} disabled={!canPick} onClick={onPick}>{pickText}</button>
        </div>
      </div>
    </div>
  )
}

function Needs({ needs, count, rounds }: { needs: DraftBoard['needs']; count: number; rounds: number }) {
  return (
    <div className="dr-needs">
      <div className="h"><span>ROSTER NEEDS · 先發缺位</span><span>{count} / {rounds}</span></div>
      <div className="g">
        {needs.map((n) => (
          <div key={n.slot} className={n.filled >= n.max ? 'full' : n.filled ? 'part' : ''}>
            <small>{n.slot}</small><b>{n.filled}<span>/{n.max}</span></b>
          </div>
        ))}
      </div>
    </div>
  )
}

function QueueList({ players, myTurn, onPick, onRemove }: { players: BoardPlayer[]; myTurn: boolean; onPick: (p: BoardPlayer) => void; onRemove: (id: number) => void }) {
  return (
    <div className="dr-side-list">
      <p className="hint">時間到會照這個順序自動選；被別隊選走的會自動移除。</p>
      {players.map((p, i) => {
        const t = cpblTeam(p.cpblTeam)
        return (
          <div key={p.playerId} className="it">
            <span className={`n${i === 0 ? ' first' : ''}`}>{i + 1}</span>
            <div className="m">
              <div className="l1"><b>{p.name}</b><i style={{ background: t.bg, color: t.fg }}>{t.short}</i></div>
              <div className="l2">{p.position} · 排名 {p.rank ?? '–'} · {keyLine(p)}</div>
            </div>
            <div className="a">
              {myTurn && <button type="button" className="dr-pick" onClick={() => onPick(p)}>選</button>}
              <button type="button" className="x" aria-label="移出候選" onClick={() => onRemove(p.playerId)}>×</button>
            </div>
          </div>
        )
      })}
      {players.length === 0 && <div className="dr-empty">還沒有候選。在球員列按 ☆ 加入。</div>}
    </div>
  )
}

function MyRoster({ draft, picks }: { draft: DraftView; picks: DraftPick[] }) {
  const n = draft.order.length || 1
  return (
    <div className="dr-side-list">
      {picks.map((p) => {
        const t = cpblTeam(p.playerTeam)
        return (
          <div key={p.pickNo} className="it mine">
            <span className="lb">{pickLabel(p.pickNo, n)}</span>
            <div className="m">
              <div className="l1"><b>{p.playerName}</b><i style={{ background: t.bg, color: t.fg }}>{t.short}</i></div>
              <div className="l2">{p.playerPosition ?? ''}{p.auto ? '・自動選' : ''}</div>
            </div>
          </div>
        )
      })}
      {draft.myKeepers.length > 0 && (
        <div className="keep"><span className="lb">KEEPER</span>{draft.myKeepers.map((k) => k.name).join('、')}</div>
      )}
      {picks.length === 0 && <div className="dr-empty">還沒選人。</div>}
    </div>
  )
}

function Seg<T extends string>({ value, items, onChange }: { value: T; items: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="dr-seg" role="tablist">
      {items.map(([v, t]) => <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  )
}

// ------------------------------------------------------------------
// 選中動畫：卡背（順位）→ 翻面（背號、名字、數據）→ 蓋章、彩帶
// ------------------------------------------------------------------

interface Reveal { pick: DraftPick; player?: BoardPlayer }

function boom() {
  if (reduced()) return
  const colors = ['#f6e1a2', '#d8b25a', '#8d6a20', '#f3f5f8', '#c4cad4']
  confetti({ particleCount: 90, angle: 60, spread: 55, startVelocity: 46, origin: { x: 0, y: 0.62 }, colors, zIndex: 80 })
  confetti({ particleCount: 90, angle: 120, spread: 55, startVelocity: 46, origin: { x: 1, y: 0.62 }, colors, zIndex: 80 })
  setTimeout(() => confetti({ particleCount: 110, spread: 100, startVelocity: 28, origin: { x: 0.5, y: 0.38 }, colors, zIndex: 80 }), 260)
}

function PickReveal({ rv, draft, onClose }: { rv: Reveal; draft: DraftView; onClose: () => void }) {
  const { league, system } = useApp()
  const [ph, setPh] = useState(0)
  useEffect(() => {
    const ts = [
      setTimeout(() => setPh(1), 40),
      setTimeout(() => setPh(2), 820),
      setTimeout(() => { setPh(3); boom(); beep([523, 659, 784, 1047], 0.2, 0.08, 'triangle', 0.16); buzz([60, 40, 90]) }, 1450),
    ]
    return () => ts.forEach(clearTimeout)
  }, [])
  const n = draft.order.length || 1
  const label = pickLabel(rv.pick.pickNo, n)
  const p = rv.player
  const t = cpblTeam(rv.pick.playerTeam)
  const tier = tierOf(p?.rank)
  const me = league?.teams.find((x) => x.id === rv.pick.teamId)
  const stats = p ? (p.pitcher ? PIT : HIT).slice(0, 4).map((c) => `${fmtStat(c, statOf(p.stats, c))} ${c}`).join(' · ') : ''
  return (
    <div className={`dr-rv ph${ph}`} onClick={() => ph >= 3 && onClose()} role="dialog" aria-label={`選中 ${rv.pick.playerName}`}>
      <div className="kick">{rv.pick.auto ? `時間到・自動選秀 · PICK ${label}` : `PICK ${label} · 第 ${rv.pick.pickNo} 順位`}</div>
      <div className="card3d">
        <div className="flip">
          <div className="face back">
            <div className="in">
              <span className="a">CPBL FANTASY</span>
              <span className="ov">{rv.pick.pickNo}</span>
              <span className="b">{system?.seasonYear} DRAFT</span>
            </div>
          </div>
          <div className={`face front t-${tier}`}>
            <div className="in" style={{ background: `linear-gradient(165deg, ${t.bg}33 0%, ${t.bg}12 42%, transparent 72%), var(--surface)` }}>
              <div className="r1"><span>{rv.pick.playerPosition ?? ''}</span><i style={{ background: t.bg, color: t.fg }}>{t.short}</i></div>
              <div className="num"><b>{rv.pick.playerJersey ?? '–'}</b><span>{TIER_LABEL[tier]}</span></div>
              <div className="nm">{rv.pick.playerName}</div>
              <div className="ln">{p ? keyLine(p) : '—'}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="seal">
        <div className="st"><i style={{ background: me ? fantasyTeamColor(me.id, league?.teams ?? []) : 'var(--gold)' }} /><b>{me?.name} 選中</b></div>
        <div className="sub">第 {rv.pick.round} 輪・排名 {p?.rank ?? '–'}{stats ? `・${stats}` : ''}</div>
        <div className="go">點任意處繼續</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀成績單（選秀完成後）
// ------------------------------------------------------------------

const REPORT_CATS = [...HIT, ...PIT]
const HL: Record<string, [string, string]> = { BEST_VALUE: ['撿到寶 · BEST VALUE', 'gold'], BOLDEST_REACH: ['最大膽 · BOLDEST REACH', 'silver'] }
const gradeTone = (g: string) => (g.startsWith('A') ? 'gold' : g.startsWith('B') ? 'silver' : 'bronze')

function DraftReportView({ draft, onClose }: { draft: DraftView; onClose: () => void }) {
  const { leagueId, league, system } = useApp()
  const wide = useWide()
  const r = useLoad(() => api.get<DraftReport>(`/api/leagues/${leagueId}/drafts/${draft.id}/report`), [leagueId, draft.id])
  const teams = league?.teams ?? []
  const n = draft.order.length || 1
  const me = r.data?.teams.find((t) => t.teamId === league?.myTeamId)
  const myTeam = teams.find((t) => t.id === league?.myTeamId)
  useEffect(() => { if (me?.grade.startsWith('A')) setTimeout(boom, 300) }, [me?.grade])
  if (r.error) return <ErrorBox error={r.error} />
  if (!r.data) return <div className="dr-empty">載入成績單…</div>
  const rep = r.data
  // 同數值名次並列：全聯盟都並列第 1 的類別不算強項（例：開季前沒有數據）
  const strong = me?.best ?? []
  const weak = me ? REPORT_CATS.filter((c) => (me.ranks[c] ?? 0) >= 4) : []
  const pts = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
  const summary = `${strong.length ? `${strong.join('、')} 預估全聯盟第 1` : '沒有類別預估第 1'}${weak.length ? `；${weak.join('、')} 偏弱，開季可以從自由球員補。` : '；10 類別都在前 3。'}`
  const rankTone = (x: number) => (x === 1 ? 'r1' : x === 2 ? 'r2' : x === 3 ? 'r3' : '')

  const gradeCard = me && (
    <div className={`rp-grade ${gradeTone(me.grade)}`}>
      <div className="in">
        <div className="top">
          <div className="g">{me.grade}</div>
          <div className="t">
            <div className="nm"><i style={{ background: fantasyTeamColor(me.teamId, teams) }} /><b>{myTeam?.name}</b></div>
            <div className="pl">預估全聯盟 <b>第 {me.place} 名</b></div>
            <div className="pt">10 類別積分 <b>{pts(me.points)}</b> / {rep.maxPoints}</div>
          </div>
        </div>
        <div className="tear" />
        <p>{summary}</p>
      </div>
    </div>
  )
  const sec = (no: string, zh: string, en: string) => <div className="rp-h"><span>{no}</span><b>{zh}</b><small>{en}</small></div>
  const cats = me && (
    <>
      {sec('01', '類別預估', 'PROJECTION')}
      <div className="rp-cats">
        {REPORT_CATS.map((c) => (
          <div key={c} className={me.ranks[c] === 1 ? 'top' : ''}>
            <small>{c}</small><b>{fmtStat(c, me.projection[c])}</b><em className={rankTone(me.ranks[c])}>第 {me.ranks[c]}</em>
          </div>
        ))}
      </div>
    </>
  )
  const highlights = rep.highlights.length > 0 && (
    <>
      {sec('02', '關鍵順位', 'HIGHLIGHTS')}
      <div className="rp-hl">
        {rep.highlights.map((h) => {
          const t = cpblTeam(h.cpblTeam)
          const [k, tone] = HL[h.kind] ?? [h.kind, 'silver']
          return (
            <div key={h.kind} className={tone}>
              <small>{k}</small>
              <div className="nm"><b>{h.name}</b><i style={{ background: t.bg, color: t.fg }}>{t.short}</i></div>
              <div className="sub">{pickLabel(h.pickNo, n)} 選中 · 排名 {h.rank ?? '–'}</div>
              <div className="d">{h.delta > 0 ? `+${h.delta}` : h.delta}</div>
            </div>
          )
        })}
      </div>
    </>
  )
  const leagueRows = (
    <>
      {sec('03', '全聯盟成績', 'LEAGUE')}
      <div className="rp-league">
        {[...rep.teams].sort((a, b) => a.place - b.place).map((t, i) => {
          const tv = teams.find((x) => x.id === t.teamId)
          return (
            <div key={t.teamId} className={t.teamId === league?.myTeamId ? 'me' : ''}>
              <i style={{ background: fantasyTeamColor(t.teamId, teams) }} />
              <span className={`i${i === 0 ? ' first' : ''}`}>{t.place}</span>
              <div className="m"><b>{tv?.name}</b><small>{tv?.owner}・最佳類別 {t.best.length ? t.best.slice(0, 2).join('、') : '—'}</small></div>
              <span className="p">{pts(t.points)} 分</span>
              <span className={`g ${gradeTone(t.grade)}`}>{t.grade}</span>
            </div>
          )
        })}
      </div>
    </>
  )
  const roster = (
    <>
      {sec('04', '我的陣容', `ROSTER · ${rep.roster.reduce((a, g) => a + g.names.length, 0)}`)}
      <div className="rp-roster">
        {rep.roster.filter((g) => g.names.length > 0).map((g) => (
          <div key={g.key}><span>{g.key}</span><div>{g.names.map((x) => <em key={x}>{x}</em>)}</div></div>
        ))}
      </div>
    </>
  )
  return (
    <div className="rp">
      <div className="rp-top">
        <button type="button" onClick={onClose}>‹ 回選秀板</button>
        <span>{draftSlots(draft).length} PICKS · FINAL</span>
      </div>
      <div className="rp-title"><span className="eb">DRAFT REPORT · {system?.seasonYear}</span><b>選秀成績單</b><small>預估依 {rep.basis} 數據，比率類別先加總再相除</small></div>
      {wide ? (
        <div className="rp-cols">
          <div>{gradeCard}{highlights}</div>
          <div>{cats}{leagueRows}</div>
          <div>{roster}</div>
        </div>
      ) : (
        <div className="rp-one">{gradeCard}{cats}{highlights}{leagueRows}{roster}</div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀室
// ------------------------------------------------------------------

export default function DraftRoom({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const done = draft.status === 'COMPLETED'
  const myTurn = draft.status === 'IN_PROGRESS' && draft.currentTeamId === league?.myTeamId
  const queue = useDraftQueue(draft)
  const board = useDraftBoard(draft)
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'avail' | 'queue' | 'board' | 'mine'>(done ? 'board' : 'avail')
  const [dtab, setDtab] = useState<'avail' | 'board'>(done ? 'board' : 'avail')
  const [side, setSide] = useState<'queue' | 'mine'>('queue')
  const [err, setErr] = useState<unknown>(null)

  const players = useMemo(() => board.data?.players ?? [], [board.data])
  const byId = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players])
  const qPlayers = queue.ids.map((id) => byId.get(id)).filter((p): p is BoardPlayer => !!p)
  const myPicks = draftSlots(draft).filter((p) => p.teamId === league?.myTeamId && p.playerId).reverse()
  const nextMe = draftSlots(draft).find((p) => p.teamId === league?.myTeamId && p.pickNo >= draft.currentPickNo && !p.playerId)
  // 網頁版右欄預設顯示排名第一的可選球員（設計稿）；被選走就換下一位
  const selP = (sel != null ? byId.get(sel) : undefined) ?? (wide ? players[0] : undefined)

  // 我的新選擇（自己選或時間到自動選）出現時播放選中動畫；剛進來時已有的不播。
  // 選中後球員已不在可選名單，數據從上一份名單找
  const [rv, setRv] = useState<Reveal | null>(null)
  const newest = myPicks[0]
  const seen = useRef(newest?.pickNo ?? 0)
  const known = useRef(new Map<number, BoardPlayer>())
  useEffect(() => { players.forEach((p) => known.current.set(p.playerId, p)) }, [players])
  useEffect(() => {
    if (!newest || newest.pickNo === seen.current || newest.playerId == null) return
    seen.current = newest.pickNo
    setRv({ pick: newest, player: known.current.get(newest.playerId) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.pickNo])

  const pick = async (p: BoardPlayer) => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/pick`, { playerId: p.playerId })
      setSel(null)
      onChange()
    } catch (e) {
      setErr(e)
    }
  }
  const reveal = rv && <PickReveal key={rv.pick.pickNo} rv={rv} draft={draft} onClose={() => setRv(null)} />
  const pickText = myTurn ? '選這位' : done ? '選秀已結束' : draft.status === 'PAUSED' ? '選秀暫停中' : draft.status !== 'IN_PROGRESS' ? '選秀尚未開始'
    : nextMe ? `還沒輪到你・再 ${nextMe.pickNo - draft.currentPickNo} 順位` : '你已選完'
  const panel = (p: BoardPlayer) => (
    <PlayerPanel p={p} basis={board.data?.basis ?? ''} inQ={queue.ids.includes(p.playerId)} onToggle={() => queue.toggle(p.playerId)}
      pickText={pickText} canPick={myTurn} onPick={() => pick(p)} />
  )
  const list = (
    <PlayerList draft={draft} board={board.data ?? null} queue={queue} myTurn={myTurn} onPick={pick}
      selId={selP?.playerId ?? null} onSelect={(p) => setSel(p.playerId)} />
  )
  const needs = board.data && <Needs needs={board.data.needs} count={myPicks.length} rounds={draft.rounds} />
  const keeperNote = draft.status === 'KEEPERS' && !draft.revealedAt && <p className="muted">Keeper 選擇期：<Link to="/draft/keepers">前往選擇 Keeper</Link></p>

  // 選完後打開成績單（剛好是自己的最後一個選擇時，等選中動畫關掉再開）
  const [report, setReport] = useState(done)
  useEffect(() => { if (done) setReport(true) }, [done])
  const reportBtn = done && <button type="button" className="dr-report-btn" onClick={() => setReport(true)}>看選秀成績單</button>
  if (done && report && !rv) {
    return <div className="dr"><DraftReportView draft={draft} onClose={() => setReport(false)} /></div>
  }
  const header = <RoomHeader draft={draft} queueLen={queue.ids.length} onReport={() => setReport(true)} onChange={onChange} />

  if (wide) {
    return (
      <div className="dr">
        {header}
        {keeperNote}
        <ErrorBox error={err || board.error} />
        <div className="dr-main">
          <div className="dr-left">
            <div className="dr-left-top">
              <Seg value={done ? 'board' : dtab} onChange={setDtab} items={done ? [['board', '選秀板']] : [['avail', '可選球員'], ['board', '選秀板']]} />
              {reportBtn}
            </div>
            {dtab === 'avail' && !done ? list : <DraftGrid draft={draft} />}
          </div>
          <div className="dr-right">
            {selP && !done && panel(selP)}
            {needs}
            <div className="dr-box">
              <Seg value={side} onChange={setSide} items={[['queue', `候選 ${qPlayers.length}`], ['mine', `我的陣容 ${myPicks.length}`]]} />
              {side === 'queue' ? <QueueList players={qPlayers} myTurn={myTurn} onPick={pick} onRemove={queue.remove} /> : <MyRoster draft={draft} picks={myPicks} />}
            </div>
          </div>
        </div>
        {reveal}
      </div>
    )
  }

  const tabs: ['avail' | 'queue' | 'board' | 'mine', string][] = done
    ? [['board', '選秀板'], ['mine', `我的 ${myPicks.length}`]]
    : [['avail', '球員'], ['queue', `候選 ${qPlayers.length}`], ['board', '選秀板'], ['mine', `我的 ${myPicks.length}`]]
  const tabNow = done && (tab === 'avail' || tab === 'queue') ? 'board' : tab
  return (
    <div className="dr">
      {header}
      {keeperNote}
      {needs}
      <ErrorBox error={err || board.error} />
      <div className="dr-tabs"><Seg value={tabNow} onChange={setTab} items={tabs} /></div>
      {tabNow === 'avail' && list}
      {tabNow === 'queue' && <QueueList players={qPlayers} myTurn={myTurn} onPick={pick} onRemove={queue.remove} />}
      {tabNow === 'board' && <>{reportBtn}<DraftGrid draft={draft} /></>}
      {tabNow === 'mine' && <MyRoster draft={draft} picks={myPicks} />}
      {sel != null && selP && (
        <BottomSheet label={selP.name} onClose={() => setSel(null)}>{panel(selP)}</BottomSheet>
      )}
      {reveal}
    </div>
  )
}
