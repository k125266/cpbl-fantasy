import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type CategoryResult, type Contribution, type Matchup, type MatchupDetail, type StandingRow } from '../api'
import { ErrorBox, fmtDate, fmtDateTime, Loading, MATCHUP_STATUS, MatchTicket, PlayerLink, TeamChip, useLoad } from '../components'
import { fmtPts, myMatchups, type MySide } from '../matchups'

interface Standings {
  half1: StandingRow[]
  half2: StandingRow[]
}

/** 大票根寬 310 + 間距 10：左右滑動時換算目前是第幾張 */
const TICKET_STEP = 320

function periodLabel(m: Matchup) {
  return m.kind === 'FINAL' ? '總冠軍賽' : `${m.halfNo === 1 ? '上' : '下'}半季 第 ${m.periodNo} 期`
}

function recText(r: StandingRow | undefined) {
  return r ? `${r.wins}-${r.losses}-${r.ties}・第 ${r.rank} 名` : undefined
}

export default function MatchupPage() {
  const { matchupId } = useParams()
  const { leagueId, league, system } = useApp()
  const list = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  const standings = useLoad(() => api.get<Standings>(`/api/leagues/${leagueId}/standings`), [leagueId])
  const [activeId, setActiveId] = useState<number | null>(null)
  const rail = useRef<HTMLDivElement>(null)

  // 換到別場對戰（網址改變）時，回到預設選中的那張
  useEffect(() => setActiveId(null), [matchupId])

  if (list.loading && !list.data) return <Loading />
  if (list.error || !list.data) return <ErrorBox error={list.error} />
  const all = list.data
  const me = league?.myTeamId ?? null

  // 要看哪一期：網址指定的那場 → 我方本期 → 我方最近一期已開始的 → 我方第一場
  const routed = matchupId ? all.find((m) => m.id === Number(matchupId)) : undefined
  const mine = me ? all.filter((m) => m.teamA === me || m.teamB === me) : []
  const focus = routed
    ?? mine.find((m) => m.periodId === league?.currentPeriod?.id)
    ?? [...mine].reverse().find((m) => m.status !== 'PENDING')
    ?? mine[0]
  if (!focus) return <p className="muted">賽程尚未產生。</p>

  // 從哪一隊的角度看：我方有參賽就是我方，否則以該場 A 隊為主
  const viewTeam = focus.teamA === me || focus.teamB === me ? me! : focus.teamA!
  const tickets = myMatchups(all, focus.periodId, viewTeam)
  const activeIdx = Math.max(0, tickets.findIndex((t) => t.m.id === (activeId ?? focus.id)))
  const active = tickets[activeIdx]

  const halfRows = focus.halfNo === 2 ? standings.data?.half2 : standings.data?.half1
  const rowOf = (teamId: number | null) => halfRows?.find((r) => r.teamId === teamId)

  const select = (i: number) => {
    setActiveId(tickets[i].m.id)
    rail.current?.scrollTo({ left: i * TICKET_STEP, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = rail.current
    if (!el) return
    const i = Math.round(el.scrollLeft / TICKET_STEP)
    if (tickets[i] && tickets[i].m.id !== active.m.id) setActiveId(tickets[i].m.id)
  }

  const byPeriod = new Map<number, Matchup[]>()
  for (const m of all) {
    if (!byPeriod.has(m.periodId)) byPeriod.set(m.periodId, [])
    byPeriod.get(m.periodId)!.push(m)
  }

  return (
    <div>
      <PeriodHero tickets={tickets} focus={focus} today={system?.today ?? league?.today ?? ''}
        teamName={league?.teams.find((t) => t.id === viewTeam)?.name ?? ''} row={rowOf(viewTeam)} />

      <div className="rail" ref={rail} onScroll={onScroll}>
        {tickets.map((v, i) => (
          <MatchTicket key={v.m.id} v={v} no={i + 1} size="lg" rec={recText(rowOf(v.oppId))}
            active={i === activeIdx} onClick={() => select(i)} />
        ))}
      </div>
      {tickets.length > 1 && (
        <div className="dots">
          {tickets.map((v, i) => (
            <button key={v.m.id} type="button" aria-label={`第 ${i + 1} 場`} aria-current={i === activeIdx} onClick={() => select(i)} />
          ))}
        </div>
      )}

      <div className="sec">
        <span className="no">01</span><span className="t">類別對決</span><span className="sub">vs {active.oppName ?? '待定'}</span>
        <span className="r"><b>{fmtPts(active.me)}</b> – {fmtPts(active.op)}</span>
      </div>
      <CategoryDuel v={active} />
      {active.m.note && <div className="alert info" style={{ marginTop: 8 }}>{active.m.note}</div>}
      <p className="note">每類別 1 分；平手或任一方無數據各得 0.5；總分 5:5 為和局。</p>

      <div className="stack">
        <ActiveContributions id={active.m.id} side={active.side} />
        <div className="h2">所有對戰</div>
        {[...byPeriod.values()].reverse().filter((ms) => ms[0].status !== 'PENDING' || ms[0].periodId === league?.currentPeriod?.id).map((ms) => (
          <div className="card flush" key={ms[0].periodId}>
            <div className="listhead">{periodLabel(ms[0])}<small>{fmtDate(ms[0].start)} – {fmtDate(ms[0].end)}</small></div>
            <div className="mlist">
              {ms.map((m) => (
                <Link key={m.id} to={`/matchups/${m.id}`}>
                  <span style={{ fontWeight: m.teamA === me || m.teamB === me ? 900 : 500 }}>{m.teamAName ?? '待定'} vs {m.teamBName ?? '待定'}</span>
                  <span className="row">
                    {m.scoreA != null && <span className="num" style={{ fontSize: 17 }}>{m.scoreA} : {m.scoreB}</span>}
                    <span className={`badge ${MATCHUP_STATUS[m.status].cls}`}>{MATCHUP_STATUS[m.status].text}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        <p className="note">尚未開始的對戰期不列出。</p>
      </div>
    </div>
  )
}

/** 本期頂部：期別、LIVE/FINAL、本期戰績與結果章、類別合計、天數進度。 */
function PeriodHero({ tickets, focus, today, teamName, row }: {
  tickets: MySide[]
  focus: Matchup
  today: string
  teamName: string
  row: StandingRow | undefined
}) {
  const allFinal = tickets.length > 0 && tickets.every((t) => t.final)
  const allPending = tickets.every((t) => t.m.status === 'PENDING')
  const live = tickets.some((t) => t.live)
  const w = tickets.filter((t) => t.result === 'W').length
  const l = tickets.filter((t) => t.result === 'L').length
  const t = tickets.length - w - l
  const sweep = allFinal && tickets.length > 1 && w === tickets.length

  const start = new Date(focus.start)
  const len = Math.round((new Date(focus.end).getTime() - start.getTime()) / 86400000) + 1
  const day = Math.min(len, Math.max(0, Math.round((new Date(today).getTime() - start.getTime()) / 86400000) + 1))
  const locksAt = tickets.find((x) => x.m.status === 'PROVISIONAL')?.m.locksAt
  const dayLabel = allPending ? `${fmtDate(focus.start)} 開始`
    : allFinal ? (locksAt ? `DAY ${len} / ${len} · ${fmtDateTime(locksAt)} 確定` : `DAY ${len} / ${len} · 已確定`)
      : `DAY ${day} / ${len} · ${fmtDate(focus.end)} 結算`

  const kickerEn = allPending ? 'NEXT · 尚未開始' : sweep ? 'SWEEP · 同期雙勝' : allFinal ? 'FINAL · 本期結果'
    : `THIS PERIOD · ${tickets.length > 1 ? '兩場' : ''}進行中`
  const kickerZh = allPending ? '本期尚未開始' : `本期 ${w} 勝 ${l} 敗${t ? ` ${t} 和` : ''}`
  const half = focus.halfNo === 2 ? '下' : '上'
  const chipText = allFinal ? { W: '勝', L: '敗', T: '和' } : { W: '領', L: '落', T: '平' }
  const periodText = focus.kind === 'FINAL' ? 'FINAL' : `H${focus.halfNo} · PERIOD ${focus.periodNo}`

  return (
    <div className="mhero">
      <div className="mh-top">
        <span>{periodText} · {fmtDate(focus.start)}–{fmtDate(focus.end)}</span>
        {!allPending && <span className={`livepill ${live ? 'live' : ''}`}>{live ? 'LIVE' : 'FINAL'}</span>}
      </div>
      <div className="mh-main">
        <div>
          <div className="kick-en">{kickerEn}</div>
          <div className="kick-zh">{kickerZh}</div>
          <div className="kick-sub">{teamName}{row && `・${half}半季 ${row.wins}-${row.losses}-${row.ties}`}</div>
        </div>
        {!allPending && (
          <div className="reschips">
            {tickets.map((x) => (
              <span key={x.m.id} className={`reschip ${allFinal ? '' : 'live'} ${x.result === 'W' ? 'w' : x.result === 'L' ? 'l' : ''}`}>
                {chipText[x.result]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mh-tot">
        <span>類別合計 <b>{fmtPts(tickets.reduce((a, x) => a + x.me, 0))}</b> : {fmtPts(tickets.reduce((a, x) => a + x.op, 0))}</span>
        <span>{dayLabel}</span>
      </div>
      <div className="dayline"><i style={{ width: `${allFinal ? 100 : allPending ? 0 : (day / len) * 100}%` }} /></div>
    </div>
  )
}

/** 類別分差：依顯示的小數位數計算，例如 AVG 領先 .012、ERA 落後 0.35。 */
function catDiff(c: CategoryResult, side: 'A' | 'B') {
  if (c.winner === 'NO_DATA') return { lead: 'none', text: '無數據' }
  if (c.winner === 'TIE') return { lead: 'tie', text: '平手' }
  const lead = c.winner === side ? 'me' : 'op'
  const a = parseFloat(c.a)
  const b = parseFloat(c.b)
  if (Number.isNaN(a) || Number.isNaN(b)) return { lead, text: lead === 'me' ? '領先' : '落後' }
  const digits = (c.a.split('.')[1] ?? '').length
  const d = Math.abs(a - b).toFixed(digits).replace(/^0\./, '.')
  return { lead, text: `${lead === 'me' ? '領先' : '落後'} ${d}` }
}

function CategoryDuel({ v }: { v: MySide }) {
  if (v.m.categories.length === 0) return <p className="muted small">本期開始後顯示各類別比較。</p>
  return (
    <div className="duel">
      {v.m.categories.map((c) => {
        const d = catDiff(c, v.side)
        return (
          <div key={c.category} className={`drow ${d.lead}`}>
            <span className="v l">{v.side === 'A' ? c.a : c.b}</span>
            <div className="mid"><b>{c.category}</b><small>{d.text}</small></div>
            <span className="v r">{v.side === 'A' ? c.b : c.a}</span>
          </div>
        )
      })}
    </div>
  )
}

function avg(h: number, ab: number) {
  return ab === 0 ? '—' : (h / ab).toFixed(3).replace(/^0/, '')
}
function era(er: number, outs: number) {
  return outs === 0 ? '—' : ((er * 27) / outs).toFixed(2)
}

/** 暫時保留的逐人貢獻表；下一步改成「本期關鍵卡」。 */
function ActiveContributions({ id, side }: { id: number; side: 'A' | 'B' }) {
  const { leagueId } = useApp()
  const { data } = useLoad(() => api.get<MatchupDetail>(`/api/leagues/${leagueId}/matchups/${id}`), [leagueId, id])
  const players = side === 'A' ? data?.playersA : data?.playersB
  return players ? <Contributions title="本期先發貢獻" players={players} /> : null
}

function Contributions({ title, players }: { title: string; players: Contribution[] }) {
  const hitters = players.filter((p) => p.totals.ab > 0 || p.totals.r > 0 || p.totals.sb > 0)
  const pitchers = players.filter((p) => p.totals.outs > 0)
  return (
    <div className="card flush">
      <div className="listhead">{title}</div>
      <div className="table-wrap" style={{ padding: '0 14px' }}>
        <table>
          <thead><tr><th>打者</th><th className="num">H/AB</th><th className="num">R</th><th className="num">HR</th><th className="num">RBI</th><th className="num">SB</th><th className="num">AVG</th></tr></thead>
          <tbody>
            {hitters.map((p) => (
              <tr key={p.playerId}>
                <td><TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} /></td>
                <td className="num">{p.totals.h}/{p.totals.ab}</td><td className="num">{p.totals.r}</td><td className="num">{p.totals.hr}</td>
                <td className="num">{p.totals.rbi}</td><td className="num">{p.totals.sb}</td><td className="num">{avg(p.totals.h, p.totals.ab)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>投手</th><th className="num">IP</th><th className="num">QS</th><th className="num">K</th><th className="num">SV+H</th><th className="num">ERA</th></tr></thead>
          <tbody>
            {pitchers.map((p) => (
              <tr key={p.playerId}>
                <td><TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} /></td>
                <td className="num">{Math.floor(p.totals.outs / 3)}.{p.totals.outs % 3}</td><td className="num">{p.totals.qs}</td>
                <td className="num">{p.totals.k}</td><td className="num">{p.totals.sv + p.totals.hld}</td><td className="num">{era(p.totals.er, p.totals.outs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
