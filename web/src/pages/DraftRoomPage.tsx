import { useApp } from '../App'
import type { DraftPick, DraftView } from '../api'
import { useServerNow, useWide } from '../hooks'
import { fantasyTeamColor } from '../teams'

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
