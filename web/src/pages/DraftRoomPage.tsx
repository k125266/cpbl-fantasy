import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../App'
import { api, type BoardPlayer, type DraftBoard, type DraftPick, type DraftStats, type DraftView } from '../api'
import { useLoad } from '../components'
import { useServerNow, useWide } from '../hooks'
import { cpblTeam, fantasyTeamColor } from '../teams'
import { Medal } from './KeeperPage'

/**
 * 選秀室 v3（設計稿「選秀室 v3」3a 網頁、3b 手機）。與設計稿的差異見 docs/decisions.md「介面與設計稿」：
 * 輪數照聯盟設定、10 類別用聯盟的類別、缺位照名單結構、「ADP」改為「排名」、不做託管與快轉。
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

/** 計時票根、標題、上一個選擇與接下來的順位橫條。 */
export function RoomHeader({ draft, queueLen = 0, onReport }: { draft: DraftView; queueLen?: number; onReport?: () => void }) {
  const { league, system } = useApp()
  const wide = useWide()
  const now = useServerNow(250)
  const teams = league?.teams ?? []
  const n = draft.order.length || teams.length || 1
  const slots = draftSlots(draft)
  const done = draft.status === 'COMPLETED'
  const live = draft.status === 'IN_PROGRESS'
  const team = teams.find((t) => t.id === draft.currentTeamId)
  const mine = live && draft.currentTeamId === league?.myTeamId
  const rem = draft.deadline ? Math.max(0, Math.ceil((Date.parse(draft.deadline) - now) / 1000)) : draft.secondsLeft
  const urgent = mine && rem <= 10
  const cur = slots.find((p) => p.pickNo === draft.currentPickNo)
  const nextMe = slots.find((p) => p.teamId === league?.myTeamId && p.pickNo >= draft.currentPickNo && !p.playerId)
  const last = slots.filter((p) => p.playerId).slice(-1)[0]
  const color = (id: number) => fantasyTeamColor(id, teams)
  const short = (id: number) => teams.find((t) => t.id === id)?.name ?? ''

  const state = done ? 'done' : urgent ? 'urgent' : mine ? 'mine' : 'idle'
  const label = cur ? pickLabel(cur.pickNo, n) : '—'
  const note = done ? '看成績單 ›'
    : !live ? '尚未開始'
      : mine ? (queueLen > 0 ? '時間到選候選第 1 位' : '時間到自動補缺位')
        : nextMe ? `再 ${nextMe.pickNo - draft.currentPickNo} 順位輪到你（${pickLabel(nextMe.pickNo, n)}）` : '你已選完'

  const idx = cur ? slots.indexOf(cur) : slots.length
  const strip = slots.slice(Math.max(0, idx - 3), Math.min(slots.length, idx + (wide ? 8 : 7)))

  return (
    <div className="dr-head">
      <div className={`dr-ticket ${state}`}>
        <div className="in">
          <div className="top">
            <div className="k"><span className="kc">{done ? '完成' : 'ON THE CLOCK'}</span>{!done && ` · ${mine ? '輪到你' : live ? `${team?.name ?? ''}選擇中` : '等待開始'}`}</div>
            <span>ROUND {done ? draft.rounds : cur?.round ?? 1} / {draft.rounds}</span>
          </div>
          <div className="mid">
            <div className="who">
              <i style={{ background: done ? 'var(--gold)' : team ? color(team.id) : 'var(--line-2)' }} />
              <b>{done ? '選秀結束' : team?.name ?? '—'}</b>
              <small>{done ? `${slots.length} 個順位全部選完` : team ? `${team.owner}・${mine ? '選一位球員' : '思考中…'}` : ''}</small>
            </div>
            <div className="time">{done || !live ? '0:00' : fmtClock(rem)}</div>
          </div>
          <div className="bar"><i style={{ width: live ? `${Math.min(100, (rem / draft.pickSeconds) * 100)}%` : '0%' }} /></div>
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
                <div className="p">{p.playerName ?? (now_ ? '選擇中' : '—')}</div>
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
const LIMIT = 40

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

  const count = rows.length > LIMIT ? `前 ${LIMIT} / ${rows.length} 位` : `${rows.length} 位`
  return (
    <div className="dr-list">
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
      {rows.slice(0, LIMIT).map((p) => {
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
      {board && rows.length === 0 && <div className="dr-empty">沒有符合的球員</div>}
      {!board && <div className="dr-empty">載入中…</div>}
      {draft.status !== 'IN_PROGRESS' && board && <p className="dr-hint">選秀開始後才能選人；現在可以先按 ☆ 排候選清單。</p>}
    </div>
  )
}

/** 選秀室資料（可選球員、缺位）：每個順位結束後重新讀取 */
export function useDraftBoard(draft: DraftView) {
  const { leagueId } = useApp()
  return useLoad(() => api.get<DraftBoard>(`/api/leagues/${leagueId}/drafts/${draft.id}/board`), [leagueId, draft.id, draft.currentPickNo, draft.status])
}
