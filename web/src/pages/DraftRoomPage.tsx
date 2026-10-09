import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { useApp } from '../App'
import { api, type BoardPlayer as ApiBoardPlayer, type DraftBoard as ApiDraftBoard, type DraftPick, type DraftReport,
  type DraftPeriod, type DraftStats, type DraftView } from '../api'
import { BottomSheet, ErrorBox, TIER_LABEL, tierOf, useLoad } from '../components'
import { useServerNow, useWide, useXWide } from '../hooks'
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

/**
 * 輪到你的提醒階段：還有 2 手（預告）→ 下一手 → 輪到你。
 * away＝距離我的下一個順位還有幾手（0 就是現在）；沒有下一個順位為 null。
 */
export type Cue = 'soon' | 'next' | 'now'
export function cueOf(away: number | null): Cue | null {
  return away === 0 ? 'now' : away === 1 ? 'next' : away === 2 ? 'soon' : null
}
/** 三個階段的聲音與震動不同：預告一個輕的單音、下一手兩個音（低到高）、輪到你三個高音 */
function playCue(c: Cue) {
  if (c === 'soon') { beep([660], 0.2, 0.1, 'sine', 0.12); buzz(40) }
  else if (c === 'next') { beep([523, 784], 0.22, 0.13, 'triangle', 0.17); buzz([80, 50, 80]) }
  else { beep([784, 1047, 1319], 0.26, 0.12, 'triangle', 0.2); buzz([140, 70, 140]) }
}
const CUE_TITLE: Record<Cue, string> = { soon: '⏳ 再 2 手輪到你', next: '⏳ 下一手是你', now: '🔔 輪到你了！' }

/** 計時票根、標題、上一個選擇與接下來的順位橫條。 */
export function RoomHeader({ draft, queueLen = 0, onReport, onChange }: { draft: DraftView; queueLen?: number; onReport?: () => void; onChange?: () => void }) {
  const posOf = useContext(PosContext)
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
  // 還沒開始（準備中、揭曉後）：等管理員按開始；揭曉後動畫播完自動開始
  const pre = !live && !paused && !done
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
      : pre ? (draft.revealedAt ? '順位已揭曉・馬上自動開始' : '等管理員按下開始選秀')
      : mine ? (myAuto ? '託管中・3 秒內自動選' : queueLen > 0 ? '時間到選候選第 1 位' : '時間到自動補缺位')
        : nextMe ? `再 ${nextMe.pickNo - draft.currentPickNo} 順位輪到你（${pickLabel(nextMe.pickNo, n)}）` : '你已選完'

  const idx = cur ? slots.indexOf(cur) : slots.length
  const strip = slots.slice(Math.max(0, idx - 3), Math.min(slots.length, idx + (wide ? 8 : 7)))

  // 輪到你的提醒：預告（還有 2 手）、下一手、輪到你，各有不同的聲音、震動與畫面；最後 5 秒每秒嗶一聲。
  // 以「目前順位變了」觸發：連續兩手都是我時，第二手也會提醒；剛進來時已經在進行中的不響
  const away = live && nextMe ? nextMe.pickNo - draft.currentPickNo : null
  const cue = cueOf(away)
  const [sound, setSound] = useState(soundOn)
  const [banner, setBanner] = useState(false)
  const alerted = useRef<number>(live ? draft.currentPickNo : -1)
  const lastTick = useRef(0)
  useEffect(() => {
    document.addEventListener('pointerdown', unlockAudio)
    return () => document.removeEventListener('pointerdown', unlockAudio)
  }, [])
  useEffect(() => {
    if (!live || alerted.current === draft.currentPickNo) return
    alerted.current = draft.currentPickNo
    setBanner(false)
    if (!cue) return
    playCue(cue)
    if (cue !== 'now') return
    setBanner(true)
    const t = setTimeout(() => setBanner(false), 2800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, draft.currentPickNo])
  // 網頁標題跟著階段變，離開或階段結束時還原
  useEffect(() => {
    if (!cue) return
    const orig = document.title
    document.title = CUE_TITLE[cue]
    return () => { document.title = orig }
  }, [cue])
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
      {cue === 'now' && <div className={`dr-glow${urgent ? ' urgent' : ''}`} aria-hidden />}
      {cue === 'now' && <div className={`dr-stick${urgent ? ' urgent' : ''}`} role="status"><b>輪到你了</b><span>剩 {fmtClock(rem)}</span></div>}
      <div className={`dr-banner${banner ? ' on' : ''}`} aria-live="polite">
        <div><i /><b>輪到你了</b><span>PICK {label} · {draft.pickSeconds} 秒</span></div>
      </div>
      {(cue === 'soon' || cue === 'next') && (
        <div className={`dr-cue ${cue}`} role="status">
          <i />{cue === 'soon' ? '再 2 手輪到你' : '下一手就是你，準備好'}
          {nextMe && <span>PICK {pickLabel(nextMe.pickNo, n)}</span>}
        </div>
      )}
      <div className={`dr-ticket ${state}`}>
        <div className="in">
          <div className="top">
            <div className="k">
              <span className="kc">{done ? '完成' : paused ? 'PAUSED' : pre ? 'WAITING' : 'ON THE CLOCK'}</span>
              {!done && ` · ${paused ? '暫停中' : pre ? '等待開始' : mine ? '輪到你' : `${team?.name ?? ''}選擇中`}`}
            </div>
            <span>ROUND {done ? draft.rounds : cur?.round ?? 1} / {draft.rounds}</span>
          </div>
          <div className="mid">
            <div className="who">
              <i style={{ background: done ? 'var(--gold)' : team ? color(team.id) : 'var(--line-2)' }} />
              <b>{done ? '選秀結束' : pre ? (draft.revealedAt ? '順位已揭曉' : '等管理員開始') : team?.name ?? '—'}</b>
              <small>{done ? `${slots.length} 個順位全部選完`
                : pre ? '現在可以先排候選清單'
                  : paused ? '管理員暫停中'
                    : team ? `${team.owner}・${auto(team.id) ? '託管・3 秒內自動選' : mine ? '選一位球員' : '思考中…'}` : ''}</small>
            </div>
            <div className="time">{done ? '0:00' : pre ? '—' : fmtClock(rem)}</div>
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
          {last ? <><i style={{ background: color(last.teamId) }} /><span>{pickLabel(last.pickNo, n)} {short(last.teamId)} → {last.playerName}{last.playerPosition ? `（${posOf(last.playerId, last.playerPosition)}）` : ''}{last.auto ? '・自動' : ''}</span></> : <span>—</span>}
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

export function fmtStat(c: string, v: number | null | undefined) {
  if (v == null) return '–'
  if (c === 'AVG') return v.toFixed(3).replace(/^0/, '')
  if (c === 'ERA' || c === 'WHIP') return v.toFixed(2)
  return String(Math.round(v))
}

/**
 * 數據表的一欄。score＝聯盟計分的類別（表頭金色）；low＝越小越好（排序時由小到大）。
 * 官網沒有打點、盜壘、中繼，所以沒有這些欄（見 docs/decisions.md「選秀室」）。
 */
interface Col { key: string; label: string; score: boolean; low: boolean; get: (s: DraftStats) => number | null; fmt: (v: number | null) => string }
const num = (v: number | null) => (v == null ? '–' : String(Math.round(v)))
const avgF = (v: number | null) => fmtStat('AVG', v)
const rateF = (v: number | null) => fmtStat('ERA', v)
const ipF = (v: number | null) => (v == null ? '–' : `${Math.floor(v / 3)}.${v % 3}`)
const col = (key: string, label: string, get: Col['get'], o: { score?: boolean; low?: boolean; fmt?: Col['fmt'] } = {}): Col =>
  ({ key, label, get, score: !!o.score, low: !!o.low, fmt: o.fmt ?? num })

/** 打者 8 欄、投手 11 欄（設計稿「選秀室 v3」） */
const H_COLS: Col[] = [
  col('g', 'G', (s) => s.g), col('pa', 'PA', (s) => s.pa), col('ab', 'AB', (s) => s.ab),
  col('h', 'H', (s) => s.h, { score: true }), col('r', 'R', (s) => s.r, { score: true }), col('hr', 'HR', (s) => s.hr, { score: true }),
  col('bb', 'BB', (s) => s.bb, { score: true }), col('avg', 'AVG', (s) => s.avg, { score: true, fmt: avgF }),
]
const P_COLS: Col[] = [
  col('g', 'G', (s) => s.pg), col('gs', 'GS', (s) => s.gs), col('ip', 'IP', (s) => s.outs, { fmt: ipF }),
  col('w', 'W', (s) => s.w, { score: true }), col('sv', 'SV', (s) => s.sv, { score: true }), col('qs', 'QS', (s) => s.qs, { score: true }),
  col('k', 'K', (s) => s.k, { score: true }), col('h', 'H', (s) => s.ph, { low: true }), col('bb', 'BB', (s) => s.pbb, { low: true }),
  col('era', 'ERA', (s) => s.era, { score: true, low: true, fmt: rateF }), col('whip', 'WHIP', (s) => s.whip, { score: true, low: true, fmt: rateF }),
]
/** W 與 SV 在聯盟計分合計為 W+SV；只在「全部」表與手機排序列使用 */
const WSV = col('wsv', 'W+SV', (s) => s.wsv, { score: true })
/** 「全部」：打者與投手共用 7 欄，上排打者、下排投手 */
const ALL_COLS: [Col, Col][] = [
  [H_COLS[0], P_COLS[0]], [H_COLS[1], P_COLS[2]], [H_COLS[4], P_COLS[5]], [H_COLS[5], P_COLS[6]],
  [H_COLS[3], WSV], [H_COLS[6], P_COLS[9]], [H_COLS[7], P_COLS[10]],
]
/** 手機排序列、候選清單等用的計分類別 */
const SORT_H: Col[] = ['r', 'hr', 'h', 'bb', 'avg'].map((k) => H_COLS.find((c) => c.key === k)!)
const SORT_P: Col[] = [P_COLS[5], P_COLS[6], WSV, P_COLS[9], P_COLS[10]]
/** 球員卡（網頁）每段期間一列的欄位：第一欄 PA／IP，後面是計分類別 */
const CARD_H: Col[] = [H_COLS[1], H_COLS[4], H_COLS[5], H_COLS[3], H_COLS[6], H_COLS[7]]
const CARD_P: Col[] = [P_COLS[2], P_COLS[5], P_COLS[6], WSV, P_COLS[9], P_COLS[10]]
const colOf = (list: Col[], key: string) => list.find((c) => c.key === key)!

/** 一位球員：stats 是目前選的數據期間，byPeriod 是各期間（球員卡逐期間列出） */
export type BoardPlayer = Omit<ApiBoardPlayer, 'stats'> & { stats: DraftStats; byPeriod: ApiBoardPlayer['stats'] }
type DraftBoard = Omit<ApiDraftBoard, 'players'> & { players: BoardPlayer[] }

const NO_STATS: DraftStats = {
  g: 0, pa: 0, ab: 0, h: 0, r: 0, hr: 0, bb: 0, avg: null,
  pg: 0, gs: 0, outs: 0, w: 0, sv: 0, wsv: 0, qs: 0, k: 0, ph: 0, pbb: 0, era: null, whip: null,
}
function withPeriod(b: ApiDraftBoard, period: DraftPeriod): DraftBoard {
  return { ...b, players: b.players.map((p) => ({ ...p, stats: p.stats[period] ?? NO_STATS, byPeriod: p.stats })) }
}

const isSp = (p: BoardPlayer) => p.eligible.includes('SP')

/**
 * 樣本太少的球員，依 AVG、ERA、WHIP 排序時排最後（使用者 2026-10-09 決定）：只投 4 局的 ERA 0.00、只打 1 個打數的 AVG 1.000
 * 不該排第一。門檻依期間：上一季全季打席 100／投球 20 局，本季 30／10 局，近 14 天 10／3 局。
 */
const MIN_SAMPLE: Record<DraftPeriod, { pa: number; outs: number }> = {
  REF: { pa: 100, outs: 60 }, SEASON: { pa: 30, outs: 30 }, LAST14: { pa: 10, outs: 9 },
}
const RATE_KEYS = new Set(['avg', 'era', 'whip'])
const lowSample = (p: BoardPlayer, period: DraftPeriod) =>
  p.pitcher ? p.stats.outs < MIN_SAMPLE[period].outs : p.stats.pa < MIN_SAMPLE[period].pa

/** 選秀紀錄（選秀板、我的陣容、選中動畫、結束畫面）存的是登記守位（投手是 P）；由選秀室提供球員的 SP／RP，查不到就用登記守位 */
const PosContext = createContext<(playerId: number | null | undefined, fallback: string | null | undefined) => string>((_, f) => f ?? '')

/** 守位：投手顯示可擔任的先發／後援（SP、RP 或 SP/RP），打者用登記守位 */
const posLabel = (p: BoardPlayer) => {
  if (!p.pitcher) return p.position
  const r = ['SP', 'RP'].filter((x) => p.eligible.includes(x))
  return r.length ? r.join('/') : p.position
}

/** 候選清單、球員卡的一行重點數據 */
export function keyLine(p: BoardPlayer) {
  const s = p.stats
  if (!p.pitcher) return `${fmtStat('AVG', s.avg)} · ${s.hr} HR`
  return isSp(p) ? `${fmtStat('ERA', s.era)} · ${s.k} K` : `${fmtStat('ERA', s.era)} · ${s.wsv} W+SV`
}

const CHIPS: [string, string][] = [['NEED', '缺位'], ['ALL', '全部'], ['H', '打者'], ['P', '投手'], ['IF', 'IF'], ['OF', 'OF'], ['SP', 'SP'], ['RP', 'RP']]
/** 每頁人數：網頁 15、手機 10（使用者 2026-10-09：25 人一頁太多） */
const pageSize = (wide: boolean) => (wide ? 15 : 10)

/** 頁碼：總頁數不超過格數就全列，否則用「…」省略（網頁 7 格、手機 5 格，同設計稿） */
function pageSeq(total: number, cur: number, slots: 5 | 7): (number | '…')[] {
  const rg = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  if (total <= slots) return rg(1, total)
  if (slots === 5) return cur <= 2 ? [1, 2, 3, '…', total] : cur >= total - 1 ? [1, '…', total - 2, total - 1, total] : [1, '…', cur, '…', total]
  return cur <= 4 ? [1, 2, 3, 4, 5, '…', total] : cur >= total - 3 ? [1, '…', ...rg(total - 4, total)] : [1, '…', cur - 1, cur, cur + 1, '…', total]
}

function Pager({ total, page, onPage, wide, bare = false }: { total: number; page: number; onPage: (n: number) => void; wide: boolean; bare?: boolean }) {
  const PAGE = pageSize(wide)
  const pages = Math.max(1, Math.ceil(total / PAGE))
  if (pages <= 1) return null
  const from = (page - 1) * PAGE + 1, to = Math.min(total, page * PAGE)
  const info = <span className="info">第 {from}–{to} 位・共 {total} 位</span>
  return (
    <div className={`dr-pager${wide ? ' w' : ''}${bare ? ' bare' : ''}`}>
      {wide && !bare && info}
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

export function PlayerList({ draft, board, period, onPeriod, queue, myTurn, onPick, selId, onSelect, x = false }: {
  /** ≥1680 三欄版：篩選收成一列、頁碼與說明在表格底下、表格本體在欄內捲動 */
  x?: boolean
  draft: DraftView
  board: DraftBoard | null
  period: DraftPeriod
  onPeriod: (p: DraftPeriod) => void
  queue: DraftQueue
  myTurn: boolean
  onPick: (p: BoardPlayer) => void
  selId: number | null
  onSelect: (p: BoardPlayer) => void
}) {
  const { league } = useApp()
  const wide = useWide()
  const teams = league?.teams ?? []
  const n = draft.order.length || 1
  const [q, setQ] = useState('')
  const [chip, setChip] = useState('ALL')
  const [sortKey, setSortKey] = useState('')
  const [showTaken, setShowTaken] = useState(false)
  // 篩了打者或投手才攤開完整欄位、才能依任一欄排序；「全部」只列 7 個共用欄
  const grp = ['H', 'IF', 'OF'].includes(chip) ? 'H' : ['P', 'SP', 'RP'].includes(chip) ? 'P' : null
  const sortCols = grp === 'P' ? [...P_COLS, WSV] : grp === 'H' ? H_COLS : []
  const sortCol = sortCols.find((c) => c.key === sortKey)
  const cols = grp === 'P' ? P_COLS : grp === 'H' ? H_COLS : null

  const all = useMemo(() => board?.players ?? [], [board])
  const open = useMemo(() => all.filter((p) => !p.taken), [all])
  const rows = useMemo(() => {
    let L = showTaken ? all : open
    if (chip === 'NEED') L = L.filter((p) => !p.taken && p.fillsNeed)
    else if (chip === 'H') L = L.filter((p) => !p.pitcher)
    else if (chip === 'P') L = L.filter((p) => p.pitcher)
    else if (chip !== 'ALL') L = L.filter((p) => p.eligible.includes(chip))
    const t = q.trim()
    if (t) L = L.filter((p) => `${p.name}${cpblTeam(p.cpblTeam).short}${posLabel(p)}`.includes(t))
    if (sortCol) {
      const rate = RATE_KEYS.has(sortCol.key)
      L = [...L].sort((a, b) => {
        if (rate) {
          const la = lowSample(a, period), lb = lowSample(b, period)
          if (la !== lb) return la ? 1 : -1
        }
        const x = sortCol.get(a.stats), y = sortCol.get(b.stats)
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
        return sortCol.low ? x - y : y - x
      })
    }
    return L
  }, [all, open, showTaken, chip, q, sortCol, period])

  // 分頁：篩選、排序、搜尋改變時回第 1 頁；被選走使總數變少時不超過最後一頁
  const [pageWant, setPageWant] = useState(1)
  useEffect(() => setPageWant(1), [chip, q, sortKey, showTaken])
  const PAGE = pageSize(wide)
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
  const count = showTaken ? `${rows.length} 位（含已選）` : `可選 ${rows.length} 位`
  // 沒有任何期間有數據時（例如開季前的 demo），仍列出預設期間
  const periods = (board?.periods ?? []).filter((x) => x.available || x.key === board?.defaultPeriod)
  const takenBox = (
    <label className="chk">
      <input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} />顯示已選
    </label>
  )
  const nCols = cols ? cols.length : ALL_COLS.length
  const chipBtns = CHIPS.map(([v, t]) => <button key={v} type="button" aria-pressed={chip === v} onClick={() => setChip(chip === v && v !== 'ALL' ? 'ALL' : v)}>{t}</button>)
  const from = (page - 1) * PAGE + 1, to = Math.min(rows.length, page * PAGE)

  const rateSort = !!sortCol && RATE_KEYS.has(sortCol.key)
  const minS = MIN_SAMPLE[period]
  const lowNote = rateSort && (
    <div className="low-note">
      樣本少（{grp === 'P' ? `投球不到 ${minS.outs / 3} 局` : grp === 'H' ? `打席不到 ${minS.pa}` : `打席不到 ${minS.pa}、投球不到 ${minS.outs / 3} 局`}）的排最後，數字旁標「少」
    </div>
  )
  const star = (p: BoardPlayer, inQ: boolean) => (
    <button type="button" className={`star${inQ ? ' on' : ''}`} aria-label={inQ ? '移出候選' : '加入候選'}
      onClick={(e) => { e.stopPropagation(); queue.toggle(p.playerId) }}>{inQ ? '★' : '☆'}</button>
  )
  return (
    <div className={`dr-list${x ? ' x' : ''}`} ref={top} style={{ '--n': nCols } as CSSProperties}>
      <div className="tools">
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋球員、中職球隊、守位" aria-label="搜尋球員" />
        </label>
        <select className="per" value={period} onChange={(e) => onPeriod(e.target.value as DraftPeriod)} aria-label="數據期間">
          {periods.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        {wide && takenBox}
        {x && <span className="sp" />}
        {x && <div className="xchips">{chipBtns}</div>}
        {wide && !x && <span className="count">{count}</span>}
      </div>
      {!x && (
        <div className="chips">
          {chipBtns}
          {wide && <span className="legend"><i />計分類別<em>篩打者或投手後可依任一欄排序</em></span>}
        </div>
      )}
      {!wide && <div className="tkrow">{takenBox}<span className="count">{count}</span></div>}
      {wide && lowNote}
      {!wide && (
        <div className="sorts">
          <span className="lab">排序</span>
          <button type="button" className={!sortCol ? 'on' : ''} onClick={() => setSortKey('')}>排名</button>
          {(grp === 'P' ? SORT_P : grp === 'H' ? SORT_H : []).map((c) => (
            <button key={c.key} type="button" className={sortCol?.key === c.key ? 'on' : ''} onClick={() => setSortKey(c.key)}>{c.label}</button>
          ))}
        </div>
      )}
      {!wide && lowNote}
      {wide && (
        <div className={`dr-row hd${cols ? '' : ' two'}`}>
          <span className="c">候選</span><span className="rk">排名</span><span>球員</span>
          {cols
            ? cols.map((c) => (
              <button key={c.key} type="button" className={`v${c.score ? ' sc' : ''}${sortCol?.key === c.key ? ' on' : ''}`}
                onClick={() => setSortKey(sortCol?.key === c.key ? '' : c.key)}>{c.label}</button>
            ))
            : ALL_COLS.map(([h, p]) => (
              <span key={h.key + p.key} className={`v${h.score || p.score ? ' sc' : ''}`}>
                {h.label === p.label ? <b>{h.label}</b> : <><b>{h.label}</b><b>{p.label}</b></>}
              </span>
            ))}
          <span />
        </div>
      )}
      <div className="rows">
      {rows.slice((page - 1) * PAGE, page * PAGE).map((p) => {
        const t = cpblTeam(p.cpblTeam)
        const inQ = queue.ids.includes(p.playerId)
        const keys: Col[] = !p.pitcher ? ['avg', 'hr', 'r'].map((k) => colOf(H_COLS, k))
          : isSp(p) ? ['era', 'k', 'qs'].map((k) => colOf(P_COLS, k)) : [colOf(P_COLS, 'era'), WSV, colOf(P_COLS, 'k')]
        if (sortCol && !keys.some((c) => c.key === sortCol.key)) keys[2] = sortCol
        const rowCols = cols ?? ALL_COLS.map(([h, pp]) => (p.pitcher ? pp : h))
        const tk = p.taken
        const low = rateSort && lowSample(p, period)
        const tkTeam = tk ? teams.find((x) => x.id === tk.teamId) : undefined
        const tkTag = tk && (
          <i className="tk"><s style={{ background: tkTeam ? fantasyTeamColor(tkTeam.id, teams) : 'var(--silver)' }} />
            {tkTeam?.name ?? ''}{tk.keeper || tk.pickNo == null ? '・Keeper' : ` ${pickLabel(tk.pickNo, n)}`}</i>
        )
        return (
          <div key={p.playerId} className={`dr-row${p.recommended && !tk ? ' rec' : ''}${selId === p.playerId ? ' sel' : ''}${tk ? ' taken' : ''}`} onClick={() => onSelect(p)}>
            {wide && (tk ? <span /> : star(p, inQ))}
            <span className="rk">{p.rank ?? '–'}</span>
            <span className="who">
              <Medal rank={p.rank} jersey={p.jerseyNumber} team={p.cpblTeam} size={x ? 32 : wide ? 30 : 36} />
              <span className="nm">
                <span className="l1">
                  <b>{p.name}</b>{!wide && <i className="tc" style={{ background: t.bg, color: t.fg }}>{t.short}</i>}
                  {p.foreign && <i className="tag">洋</i>}{p.recommended && !tk && <i className="tag gold">推薦</i>}{tkTag}
                </span>
                {wide
                  ? <span className="l2"><i className="tc" style={{ background: t.bg, color: t.fg }}>{t.short}</i><em className={p.fillsNeed && !tk ? 'need' : ''}>{posLabel(p)}</em></span>
                  : (
                    <span className="l2">
                      <em className={p.fillsNeed && !tk ? 'need' : ''}>{posLabel(p)}</em>
                      {keys.map((c) => {
                        const mark = low && sortCol?.key === c.key
                        return <span key={c.key} className={`${sortCol?.key === c.key ? 'on' : ''}${mark ? ' low' : ''}`}><b>{c.fmt(c.get(p.stats))}</b>{c.label}{mark && <sup>少</sup>}</span>
                      })}
                    </span>
                  )}
              </span>
            </span>
            {wide && rowCols.map((c) => {
              const mark = low && sortCol?.key === c.key
              return <span key={c.key} className={`v${c.score ? ' sc' : ''}${sortCol?.key === c.key ? ' on' : ''}${mark ? ' low' : ''}`}>{c.fmt(c.get(p.stats))}{mark && <sup title="樣本少">少</sup>}</span>
            })}
            {!wide && (tk ? <span /> : star(p, inQ))}
            <span className="act">{myTurn && !tk && <button type="button" className="dr-pick" onClick={(e) => { e.stopPropagation(); onPick(p) }}>選</button>}</span>
          </div>
        )
      })}
      {board && rows.length === 0 && <div className="dr-empty">沒有符合的球員</div>}
      {!board && <div className="dr-empty">載入中…</div>}
      </div>
      {x ? (
        <div className="foot">
          <span className="info">{rows.length ? `第 ${from}–${to} 人・共 ${rows.length} 人` : ''}</span>
          <span className="legend"><i />計分類別</span>
          <span className="hint">{grp ? '點表頭排序，再點回到排名' : '表頭上排打者、下排投手'}</span>
          <span className="sp" />
          <Pager total={rows.length} page={page} onPage={goPage} wide={wide} bare />
        </div>
      ) : <Pager total={rows.length} page={page} onPage={goPage} wide={wide} />}
      {draft.status !== 'IN_PROGRESS' && board && <p className="dr-hint">選秀開始後才能選人；現在可以先按 ☆ 排候選清單。</p>}
    </div>
  )
}

// ------------------------------------------------------------------
// ≥1680 常駐的選秀板（設計稿 WebDraftRoom）：每隊表頭加打投人數；格子有姓名、守位、中職色點、第幾順位；
// 目前這一手脈動、輪到自己寫「輪到你」；點已選的格子，右邊球員卡換成那位
// ------------------------------------------------------------------

function BoardPanel({ draft, byId, selId, onSelect }: { draft: DraftView; byId: Map<number, BoardPlayer>; selId: number | null; onSelect: (playerId: number) => void }) {
  const { league } = useApp()
  const posOf = useContext(PosContext)
  const teams = league?.teams ?? []
  // 順位還沒揭曉時先用聯盟隊伍排出空板，不要留一片空白
  const ordered = draft.order.length > 0
  const order = ordered ? draft.order : teams.map((t) => t.id)
  const n = order.length || 1
  const slots = draftSlots(draft)
  const at = new Map(slots.map((p) => [`${p.round}-${p.teamId}`, p]))
  const live = draft.status === 'IN_PROGRESS'
  const mineId = league?.myTeamId
  const cur = useRef<HTMLDivElement | null>(null)
  // 目前這一手捲到可見（欄內捲動）
  useEffect(() => { cur.current?.scrollIntoView({ block: 'nearest' }) }, [draft.currentPickNo])
  const mix = (teamId: number) => {
    const ps = slots.filter((p) => p.teamId === teamId && p.playerId)
    const pit = ps.filter((p) => byId.get(p.playerId!)?.pitcher).length
    return `打 ${ps.length - pit}・投 ${pit}`
  }
  const cols = { gridTemplateColumns: `34px repeat(${n}, minmax(0, 1fr))` }
  return (
    <div className="dr-bd">
      <div className="bh"><span>DRAFT BOARD · 選秀板</span><em>{ordered ? `${draft.snake ? '蛇形' : '每輪同順序'}・點格子看球員` : '順位揭曉後排入'}</em></div>
      <div className="bt" style={cols}>
        <span />
        {order.map((id) => {
          const t = teams.find((x) => x.id === id)
          return (
            <div key={id} className={id === mineId ? 'me' : ''}>
              <i style={{ background: fantasyTeamColor(id, teams) }} />
              <b>{t?.name}{id === mineId && <small>你</small>}</b>
              <span>{mix(id)}</span>
            </div>
          )
        })}
      </div>
      <div className="br">
        {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((r) => {
          const back = draft.snake && r % 2 === 0
          return (
            <div key={r} className="r" style={cols}>
              <div className="rn">R{r}<span>{back ? '←' : '→'}</span></div>
              {order.map((id) => {
                const p = at.get(`${r}-${id}`)
                const isCur = live && p?.pickNo === draft.currentPickNo
                const me = id === mineId
                const player = p?.playerId ? byId.get(p.playerId) : undefined
                const t = player ? cpblTeam(player.cpblTeam) : p?.playerTeam ? cpblTeam(p.playerTeam) : null
                return (
                  <div key={id} ref={isCur ? cur : undefined}
                    className={`c${p?.playerId ? ' done' : ''}${isCur ? ' cur' : ''}${me ? ' me' : ''}${player && selId === player.playerId ? ' sel' : ''}`}
                    onClick={() => player && onSelect(player.playerId)}>
                    {p?.playerId ? (
                      <>
                        <span className="nm">{p.playerName}</span>
                        <span className="ft">
                          {t && <s style={{ background: t.bg }} />}
                          <span className="ps">{posOf(p.playerId, p.playerPosition)}</span>
                          {t && <span className="tn">{t.short}</span>}
                          <span className="no">#{p.pickNo}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="nm">{isCur ? (me ? '輪到你' : '選擇中') : me ? '你' : ''}</span>
                        <span className="ft"><span className="no w">{p ? pickLabel(p.pickNo, n) : ''}</span></span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀板：輪 × 隊伍（照揭曉的順位）；蛇形雙數輪反向，補強選秀每輪同順序
// ------------------------------------------------------------------

export function DraftGrid({ draft }: { draft: DraftView }) {
  const posOf = useContext(PosContext)
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
                    <span>{p ? posOf(p.playerId, p.playerPosition) : ''}</span>
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
  return useLoad(() => api.get<ApiDraftBoard>(`/api/leagues/${leagueId}/drafts/${draft.id}/board`),
    [leagueId, draft.id, draft.currentPickNo, draft.status])
}

// ------------------------------------------------------------------
// 球員卡、先發缺位、候選清單、我的陣容
// ------------------------------------------------------------------

/** 球員的各期間數據表：網頁卡片只列計分類別，手機的完整數據列出全部欄位（可左右捲動） */
function StatTable({ p, periods, period, full }: { p: BoardPlayer; periods: ApiDraftBoard['periods']; period: DraftPeriod; full: boolean }) {
  const cols = p.pitcher ? (full ? P_COLS : CARD_P) : (full ? H_COLS : CARD_H)
  return (
    <div className={`dr-pt${full ? ' full' : ''}`} style={{ '--n': cols.length } as CSSProperties}>
      <div className="r hd"><span className="lb">期間</span>{cols.map((c) => <span key={c.key} className={`v${c.score ? ' sc' : ''}`}>{c.label}</span>)}</div>
      {periods.map((x) => {
        const s = p.byPeriod[x.key]
        return (
          <div key={x.key} className={`r${x.key === period ? ' cur' : ''}${s ? '' : ' none'}`}>
            <span className="lb">{x.label}</span>
            {cols.map((c) => <span key={c.key} className="v">{s ? c.fmt(c.get(s)) : '—'}</span>)}
          </div>
        )
      })}
    </div>
  )
}

function PlayerPanel({ p, board, period, inQ, onToggle, pickText, canPick, onPick, full }: {
  p: BoardPlayer; board: DraftBoard; period: DraftPeriod; inQ: boolean; onToggle: () => void; pickText: string; canPick: boolean; onPick: () => void; full: boolean
}) {
  const { league } = useApp()
  const teams = league?.teams ?? []
  const t = cpblTeam(p.cpblTeam)
  const tier = tierOf(p.rank)
  const tk = p.taken
  const tkTeam = tk ? teams.find((x) => x.id === tk.teamId) : undefined
  const have = board.periods.filter((x) => p.byPeriod[x.key])
  const colN = p.pitcher ? P_COLS.length : H_COLS.length
  return (
    <div className={`dr-card t-${tier}`}>
      <div className="in" style={{ background: `linear-gradient(165deg, ${t.bg}33 0%, ${t.bg}12 42%, transparent 72%), var(--surface)` }}>
        <div className="top"><span>PLAYER CARD</span><span className="ink">排名 {p.rank ?? '–'} · {TIER_LABEL[tier]}</span></div>
        <div className="id">
          <Medal rank={p.rank} jersey={p.jerseyNumber} team={p.cpblTeam} size={56} />
          <div>
            <div className="l1"><b>{p.name}</b><i style={{ background: t.bg, color: t.fg }}>{t.short}</i>{p.foreign && <i className="tag">洋</i>}</div>
            <div className={`pos${p.fillsNeed && !tk ? ' need' : ''}`}>
              {p.eligible.join('・')}{p.fillsNeed && !tk ? '・補先發缺位' : ''}
              {tk && <span className="tk"><s style={{ background: tkTeam ? fantasyTeamColor(tkTeam.id, teams) : 'var(--silver)' }} />{tkTeam?.name}{tk.keeper || tk.pickNo == null ? '・Keeper' : '・已選走'}</span>}
            </div>
          </div>
        </div>
        {full && <div className="ft"><span>完整數據・{colN} 項</span><span>左右滑動 ›</span></div>}
        <StatTable p={p} periods={board.periods} period={period} full={full} />
        <div className="ft">
          <span>{have.length === 1 ? `開季前只有 ${have[0].label}・` : ''}金色為計分類別</span>
          <Link to={`/players/${p.playerId}`}>看完整球員頁 ›</Link>
        </div>
        <div className="btns">
          <button type="button" className={`q${inQ ? ' on' : ''}`} onClick={onToggle} disabled={!!tk}>{inQ ? '★ 候選中' : '☆ 候選'}</button>
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
              <div className="l2">{posLabel(p)} · 排名 {p.rank ?? '–'} · {keyLine(p)}</div>
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
  const posOf = useContext(PosContext)
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
              <div className="l2">{posOf(p.playerId, p.playerPosition)}{p.auto ? '・自動選' : ''}</div>
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
  const posOf = useContext(PosContext)
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
  const stats = p ? (p.pitcher ? SORT_P : SORT_H).slice(0, 4).map((c) => `${c.fmt(c.get(p.stats))} ${c.label}`).join(' · ') : ''
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
              <div className="r1"><span>{posOf(rv.pick.playerId, rv.pick.playerPosition)}</span><i style={{ background: t.bg, color: t.fg }}>{t.short}</i></div>
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
// 選秀結束畫面：人在選秀室、看著選秀結束時出現一次（之後從「選秀紀錄」回來看選秀板與成績單）
// ------------------------------------------------------------------

function DraftFinish({ draft, mine, onReport, onClose }: { draft: DraftView; mine: DraftPick[]; onReport: () => void; onClose: () => void }) {
  const posOf = useContext(PosContext)
  const { leagueId, league, system } = useApp()
  const r = useLoad(() => api.get<DraftReport>(`/api/leagues/${leagueId}/drafts/${draft.id}/report`), [leagueId, draft.id])
  const me = r.data?.teams.find((t) => t.teamId === league?.myTeamId)
  const n = draft.order.length || 1
  useEffect(() => {
    beep([523, 659, 784, 1047, 1319], 0.22, 0.09, 'triangle', 0.16)
    buzz([60, 40, 90, 40, 140])
  }, [])
  // 成績單 A 級才放彩帶
  useEffect(() => { if (me?.grade.startsWith('A')) setTimeout(boom, 300) }, [me?.grade])
  return (
    <div className="dr-fin" role="dialog" aria-modal="true" aria-label="選秀結束">
      <div className="box">
        <span className="kick">DRAFT COMPLETE · {system?.seasonYear}</span>
        <h2>選秀結束</h2>
        <p className="sub">
          {draft.halfNo === 2 ? '下半季補強選秀' : '上半季選秀'}・共 {draftSlots(draft).length} 手
          {me && <>・你的成績單 <b className={`g ${gradeTone(me.grade)}`}>{me.grade}</b></>}
        </p>
        <div className="mine">
          <div className="mh">你的陣容 · {mine.length} 人</div>
          <ol>
            {mine.map((p) => (
              <li key={p.pickNo}>
                <span className="no">{pickLabel(p.pickNo, n)}</span>
                <b>{p.playerName}</b>
                <em>{posOf(p.playerId, p.playerPosition)}</em>
              </li>
            ))}
          </ol>
        </div>
        <div className="btns">
          <button type="button" className="ghost" onClick={onClose}>看選秀板</button>
          <button type="button" className="gold" onClick={onReport}>看成績單</button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀室
// ------------------------------------------------------------------

function DraftRoomInner({ draft, onChange, posMap }: { draft: DraftView; onChange: () => void; posMap: Map<number, string> }) {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const done = draft.status === 'COMPLETED'
  // ≥1680：選秀板常駐，三欄一屏（設計稿 WebDraftRoom）；選完的選秀沿用 1440 的版面
  const x = useXWide() && !done
  const myTurn = draft.status === 'IN_PROGRESS' && draft.currentTeamId === league?.myTeamId
  const queue = useDraftQueue(draft)
  const raw = useDraftBoard(draft)
  // 數據期間：預設用後端建議的（上半季選秀前只有上一季）；選了但之後不可用就退回預設
  const [periodWant, setPeriodWant] = useState<DraftPeriod | null>(null)
  const period = periodWant && raw.data?.periods.some((x) => x.key === periodWant && (x.available || x.key === raw.data?.defaultPeriod)) ? periodWant : raw.data?.defaultPeriod ?? 'SEASON'
  const boardData = useMemo(() => (raw.data ? withPeriod(raw.data, period) : null), [raw.data, period])
  const board = { data: boardData, error: raw.error }
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'avail' | 'queue' | 'board' | 'mine'>(done ? 'board' : 'avail')
  const [dtab, setDtab] = useState<'avail' | 'board'>(done ? 'board' : 'avail')
  const [side, setSide] = useState<'queue' | 'mine'>('queue')
  const [err, setErr] = useState<unknown>(null)

  const players = useMemo(() => board.data?.players ?? [], [board.data])
  players.forEach((p) => posMap.set(p.playerId, posLabel(p)))
  const openPlayers = useMemo(() => players.filter((p) => !p.taken), [players])
  const byId = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players])
  const qPlayers = queue.ids.map((id) => byId.get(id)).filter((p): p is BoardPlayer => !!p && !p.taken)
  const myPicks = draftSlots(draft).filter((p) => p.teamId === league?.myTeamId && p.playerId).reverse()
  const nextMe = draftSlots(draft).find((p) => p.teamId === league?.myTeamId && p.pickNo >= draft.currentPickNo && !p.playerId)
  // 網頁版右欄預設顯示排名第一的可選球員（設計稿）；被選走就換下一位
  const selP = (sel != null ? byId.get(sel) : undefined) ?? (wide ? openPlayers[0] : undefined)

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
      setSide('mine') // 選完後右側切到「我的陣容」，看那一手填進去
      onChange()
    } catch (e) {
      setErr(e)
    }
  }
  const reveal = rv && <PickReveal key={rv.pick.pickNo} rv={rv} draft={draft} onClose={() => setRv(null)} />
  const pickText = myTurn ? '選這位' : done ? '選秀已結束' : draft.status === 'PAUSED' ? '選秀暫停中' : draft.status !== 'IN_PROGRESS' ? '選秀尚未開始'
    : nextMe ? `還沒輪到你・再 ${nextMe.pickNo - draft.currentPickNo} 順位` : '你已選完'
  const panel = (p: BoardPlayer) => (
    board.data && <PlayerPanel p={p} board={board.data} period={period} inQ={queue.ids.includes(p.playerId)} onToggle={() => queue.toggle(p.playerId)}
      pickText={p.taken ? '已被選走' : pickText} canPick={myTurn && !p.taken} onPick={() => pick(p)} full={!wide} />
  )
  const list = (
    <PlayerList draft={draft} board={board.data} period={period} onPeriod={setPeriodWant} queue={queue} myTurn={myTurn} onPick={pick}
      selId={selP?.playerId ?? null} onSelect={(p) => setSel(p.playerId)} x={x} />
  )
  const needs = board.data && <Needs needs={board.data.needs} count={myPicks.length} rounds={draft.rounds} />
  const keeperNote = draft.status === 'KEEPERS' && !draft.revealedAt && <p className="muted">Keeper 選擇期：<Link to="/draft/keepers">前往選擇 Keeper</Link></p>

  // 成績單由「看成績單」打開；人在選秀室、看著選秀結束時，先出現一次結束畫面
  // （剛好是自己的最後一個選擇時，等選中動畫關掉再出現）
  const [report, setReport] = useState(false)
  const mountedLive = useRef(!done)
  const finishShown = useRef(false)
  const [finish, setFinish] = useState(false)
  useEffect(() => {
    if (done && mountedLive.current && !finishShown.current) { finishShown.current = true; setFinish(true) }
  }, [done])
  const finishEl = finish && !rv && (
    <DraftFinish draft={draft} mine={[...myPicks].reverse()} onClose={() => setFinish(false)} onReport={() => { setFinish(false); setReport(true) }} />
  )
  const reportBtn = done && <button type="button" className="dr-report-btn" onClick={() => setReport(true)}>看選秀成績單</button>
  if (done && report && !rv) {
    return <div className="dr"><DraftReportView draft={draft} onClose={() => setReport(false)} /></div>
  }
  const header = <RoomHeader draft={draft} queueLen={queue.ids.length} onReport={() => setReport(true)} onChange={onChange} />

  if (x) {
    return (
      <div className={`dr dr-x${myTurn ? ' mine' : ''}`}>
        {header}
        {keeperNote}
        <ErrorBox error={err || board.error} />
        <div className="dr-main dr-main-x">
          <div className="dr-left">{list}</div>
          <BoardPanel draft={draft} byId={byId} selId={selP?.playerId ?? null} onSelect={(id) => setSel(id)} />
          <div className="dr-right">
            {selP && panel(selP)}
            {needs}
            <div className="dr-box">
              <Seg value={side} onChange={setSide} items={[['queue', `候選 ${qPlayers.length}`], ['mine', `我的陣容 ${myPicks.length}`]]} />
              {side === 'queue' ? <QueueList players={qPlayers} myTurn={myTurn} onPick={pick} onRemove={queue.remove} /> : <MyRoster draft={draft} picks={myPicks} />}
            </div>
          </div>
        </div>
        {reveal}
        {finishEl}
      </div>
    )
  }

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
        {finishEl}
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
      {finishEl}
    </div>
  )
}

/** 選秀室：外層提供「球員 → SP／RP 守位」給選秀板、我的陣容、選中動畫、結束畫面（見 PosContext） */
export default function DraftRoom(props: { draft: DraftView; onChange: () => void }) {
  const posMap = useRef(new Map<number, string>())
  const posOf = useCallback((id: number | null | undefined, fallback: string | null | undefined) =>
    (id != null ? posMap.current.get(id) : undefined) ?? fallback ?? '', [])
  return <PosContext.Provider value={posOf}><DraftRoomInner {...props} posMap={posMap.current} /></PosContext.Provider>
}
