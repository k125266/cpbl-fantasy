import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Matchup, type RosterPlayer, type RosterResponse, type SlotName, type StandingRow } from '../api'
import { Avatar, BottomSheet, ErrorBox, fmtDate, fmtTime, Loading, MatchTicket, TeamChip, toast, useLoad, weekday } from '../components'
import { fmtPts, myMatchups, periodDay, type MySide } from '../matchups'
import { cpblTeam, fantasyTeamColor } from '../teams'

interface Seat {
  slot: SlotName
  player: RosterPlayer | null
}

const GROUPS: [string, SlotName[]][] = [
  ['打者', ['IF', 'OF', 'UTIL']],
  ['投手', ['SP', 'RP']],
  ['板凳・NA', ['BN', 'NA']],
]

function isPitcherRow(p: RosterPlayer) {
  return p.slot === 'SP' || p.slot === 'RP' || p.listedPosition === 'P'
}

function gameText(p: RosterPlayer): { text: string; cls?: string } {
  const g = p.game
  if (p.status.code === 'MINORS') return { text: p.status.text, cls: 'amber' }
  if (p.status.code === 'DELISTED') return { text: p.status.text, cls: 'red' }
  if (!g) return { text: '今日無比賽' }
  const opp = `${g.home ? 'vs' : '@'} ${cpblTeam(g.opponent).short}`
  switch (g.status) {
    case 'POSTPONED': return { text: '延賽・待補賽', cls: 'amber' }
    case 'FINAL': return { text: `已結束 ${opp}` }
    case 'IN_PROGRESS': return { text: `進行中 ${opp}`, cls: 'green' }
    case 'SUSPENDED': return { text: `保留比賽 ${opp}`, cls: 'amber' }
    default: return { text: `${fmtTime(g.startTime)} ${opp}` }
  }
}

export default function TeamPage() {
  const { teamId } = useParams()
  const { leagueId, league, reloadLeague } = useApp()
  const navigate = useNavigate()
  const id = teamId ? Number(teamId) : league?.myTeamId
  const mine = id === league?.myTeamId
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${id}/roster`), [leagueId, id])
  const matchups = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  const standings = useLoad(() => api.get<{ half1: StandingRow[]; half2: StandingRow[] }>(`/api/leagues/${leagueId}/standings`), [leagueId])
  const [sheet, setSheet] = useState<RosterPlayer | null>(null)

  if (!id) return <p className="muted">找不到隊伍</p>
  if (roster.loading && !roster.data) return <Loading />
  if (roster.error || !roster.data) return <ErrorBox error={roster.error} />
  const data = roster.data
  const team = league?.teams.find((t) => t.id === id)
  const halfNo = league?.currentPeriod?.halfNo ?? 1
  const halfRows = (halfNo === 2 ? standings.data?.half2 : standings.data?.half1) ?? []
  // 每期雙對手：本期有兩場
  const tickets = myMatchups(matchups.data ?? [], data.period?.id, id)

  const seats = (slots: SlotName[]): Seat[] => {
    const out: Seat[] = []
    for (const s of slots) {
      const ps = data.players.filter((p) => p.slot === s)
      ps.forEach((p) => out.push({ slot: s, player: p }))
      for (let i = ps.length; i < (data.slotCounts[s] ?? 0); i++) out.push({ slot: s, player: null })
    }
    return out
  }

  const starters = data.players.filter((p) => !['BN', 'NA'].includes(p.slot))
  const problems = starters.filter((p) => p.status.code !== 'ACTIVE' || p.game?.status === 'POSTPONED')
  const reload = () => {
    roster.reload()
    reloadLeague()
  }

  return (
    <div className="stack" style={{ paddingTop: 0 }}>
      <TeamHero teamId={id} name={data.teamName} abbr={team?.abbr ?? ''} owner={team?.owner ?? ''} mine={mine} halfNo={halfNo}
        rows={halfRows} tickets={tickets} today={data.today} teamIds={(league?.teams ?? []).map((t) => t.id)} />

      <div className="pills">
        <span className="pill">{fmtDate(data.today)} 週{weekday(data.today)}</span>
        <span className="pill">FAAB {data.faabBudget}</span>
        <span className="pill">{data.players.filter((p) => p.slot !== 'NA').length}/{data.rosterSize} 人・洋將 {data.players.filter((p) => p.foreign).length}/{data.foreignLimit}</span>
        {!mine && <button type="button" className="pill gold" onClick={() => navigate('/')}>回我的隊伍</button>}
      </div>

      {data.lineupLockReason && <div className="alert error">名單鎖定中：{data.lineupLockReason}</div>}

      {mine && problems.length > 0 && <TodayNotice problems={problems} onOpen={setSheet} />}

      {GROUPS.map(([label, slots]) => (
        <div className="card flush" key={label}>
          <div className="listhead">{label}{label === '打者' && data.period && <small>本期 {fmtDate(data.period.startDate)}–{fmtDate(data.period.endDate)}</small>}</div>
          {seats(slots).map((seat, i) => <Row key={seat.player?.playerId ?? `${seat.slot}${i}`} seat={seat} onOpen={setSheet} />)}
        </div>
      ))}

      {sheet && (
        <MoveSheet player={sheet} data={data} mine={mine} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload() }} />
      )}
    </div>
  )
}

/** 隊伍頭部：名次與戰績、撕線下方本期兩張小票根與進度。 */
function TeamHero({ teamId, name, abbr, owner, mine, halfNo, rows, tickets, today, teamIds }: {
  teamId: number
  name: string
  abbr: string
  owner: string
  mine: boolean
  halfNo: number
  rows: StandingRow[]
  tickets: MySide[]
  today: string
  teamIds: number[]
}) {
  const st = rows.find((r) => r.teamId === teamId)
  const half = halfNo === 2 ? '下' : '上'
  // 與第 1 名（或第 2 名）的場差：((勝差) + (敗差)) / 2
  const gap = (a: StandingRow, b: StandingRow) => ((a.wins - b.wins) + (b.losses - a.losses)) / 2
  let gbText = ''
  if (st) {
    const other = rows.find((r) => r.rank === (st.rank === 1 ? 2 : 1))
    const g = other ? (st.rank === 1 ? gap(st, other) : gap(other, st)) : 0
    gbText = g === 0 ? (other ? '並列第 1' : '') : st.rank === 1 ? `領先 ${fmtPts(g)} 場` : `落後 ${fmtPts(g)} 場`
  }
  const m0 = tickets[0]?.m
  const allFinal = tickets.length > 0 && tickets.every((t) => t.final)
  const allPending = tickets.every((t) => t.m.status === 'PENDING')
  const live = tickets.some((t) => t.live)
  const w = tickets.filter((t) => t.result === 'W').length
  const l = tickets.filter((t) => t.result === 'L').length
  const t = tickets.length - w - l
  const { day, len } = m0 ? periodDay(m0.start, m0.end, today) : { day: 0, len: 1 }

  return (
    <div className="thero">
      <div className="wm" aria-hidden="true">{abbr}</div>
      <div className="th-top">
        <div style={{ minWidth: 0 }}>
          <div className="kick-en">{mine ? 'MY TEAM' : 'TEAM'} · H{halfNo}{st ? ` RANK ${st.rank}` : ''}</div>
          <div className="th-name">{name}</div>
          <div className="th-sub">{owner}{st && `・${half}半季第 ${st.rank} 名`}{gbText && `・${gbText}`}</div>
        </div>
        <div className="th-rec">
          <small>H{halfNo} · W – L – T</small>
          <b>{st?.wins ?? 0}<i>-</i>{st?.losses ?? 0}<i>-</i>{st?.ties ?? 0}</b>
        </div>
      </div>

      <div className="th-cut">
        {m0 ? (
          <>
            <div className="mh-top">
              <span><b className="c-w" style={{ fontWeight: 500 }}>TICKETS</b> · {m0.kind === 'FINAL' ? 'FINAL' : `PERIOD ${m0.periodNo}`} · {fmtDate(m0.start)}–{fmtDate(m0.end)}</span>
              {!allPending && <span className={`livepill ${live ? 'live' : ''}`}>{live ? 'LIVE' : 'FINAL'}</span>}
            </div>
            <div className={`th-tix ${tickets.length === 1 ? 'one' : ''}`}>
              {tickets.map((v, i) => <MatchTicket key={v.m.id} v={v} no={i + 1} size="sm" color={fantasyTeamColor(v.oppId, teamIds)} />)}
            </div>
            <div className="mh-tot">
              <span>{allPending ? '本期尚未開始' : `本期 ${w} 勝 ${l} 敗${t ? ` ${t} 和` : ''}`} · 類別合計 <b>{fmtPts(tickets.reduce((a, x) => a + x.me, 0))}</b> : {fmtPts(tickets.reduce((a, x) => a + x.op, 0))}</span>
              <span>{allPending ? `${fmtDate(m0.start)} 開始` : `DAY ${allFinal ? len : day} / ${len}`}</span>
            </div>
            <div className="dayline"><i style={{ width: `${allFinal ? 100 : allPending ? 0 : (day / len) * 100}%` }} /></div>
          </>
        ) : <p className="muted small" style={{ margin: 0 }}>目前不在對戰期間（開季前或例行賽結束）。</p>}
      </div>
    </div>
  )
}

function TodayNotice({ problems, onOpen }: { problems: RosterPlayer[]; onOpen: (p: RosterPlayer) => void }) {
  const [all, setAll] = useState(false)
  const status = problems.filter((p) => p.status.code !== 'ACTIVE')
  const postponed = problems.filter((p) => p.status.code === 'ACTIVE')
  const shown = all ? status : status.slice(0, 3)
  return (
    <div className="notice">
      <div className="notice-title">今天要注意</div>
      {shown.map((p) => (
        <div className="nrow" key={p.playerId}>
          <span className="d" style={{ background: 'var(--bad)' }} />
          <span><b>{p.name}</b> 在 {p.slot} 先發，{p.status.text}</span>
          <button type="button" className="small" onClick={() => onOpen(p)}>換人</button>
        </div>
      ))}
      {status.length > 3 && !all && <button type="button" className="small" style={{ justifySelf: 'start' }} onClick={() => setAll(true)}>還有 {status.length - 3} 位</button>}
      {postponed.length > 0 && (
        <div className="nrow">
          <span className="d" style={{ background: 'var(--warn)' }} />
          <span>{postponed.length} 名先發所屬球隊今日延賽：{postponed.map((p) => p.name).join('、')}</span>
          <span />
        </div>
      )}
    </div>
  )
}

function Row({ seat, onOpen }: { seat: Seat; onOpen: (p: RosterPlayer) => void }) {
  const p = seat.player
  const starting = !['BN', 'NA'].includes(seat.slot)
  if (!p) {
    return (
      <div className="prow empty">
        <div className="slot on">{seat.slot}</div>
        <div className="av" style={{ ['--tc' as string]: 'var(--line)' }} />
        <div className="ps">（空位）</div>
        <div />
      </div>
    )
  }
  const g = gameText(p)
  const problem = starting && (p.status.code !== 'ACTIVE' || p.game?.status === 'POSTPONED')
  const pit = isPitcherRow(p)
  return (
    <button type="button" className={`prow ${p.status.code === 'DELISTED' ? 'delisted' : problem ? 'problem' : ''}`} onClick={() => onOpen(p)}>
      <div className={`slot ${starting ? 'on' : ''}`}>{seat.slot}</div>
      <Avatar team={p.cpblTeam} number={p.jerseyNumber} />
      <div style={{ minWidth: 0 }}>
        <div className="pn">
          {p.name}
          {p.status.code === 'IDLE' && <span className="badge danger">{p.status.text}</span>}
          {p.status.code === 'MINORS' && <span className="badge warn">二軍</span>}
          {p.status.code === 'DELISTED' && <span className="badge danger">已註銷</span>}
          {p.locked && <span className="badge lock">鎖定</span>}
        </div>
        <div className="ps">{cpblTeam(p.cpblTeam).short}・{p.eligible.join(',') || '—'}{p.foreign && '・洋'}</div>
        <div className={`ps ${g.cls ?? ''}`}>{g.text}</div>
        {p.today && <div className="pl">{p.today.text}{p.today.live && <span className="badge live">非最終</span>}</div>}
        {p.pendingFrom && <div className="pl amber">{fmtDate(p.pendingFrom)} 起生效</div>}
        {p.leavingOn && <div className="pl amber">{fmtDate(p.leavingOn)} 離隊</div>}
      </div>
      <div className="pv">
        <span className="num">{pit ? p.season.ERA : p.season.AVG}</span>
        <small>{pit ? 'ERA' : 'AVG'}</small>
      </div>
    </button>
  )
}

/** 該球員能否移入某個位置。 */
function canPlay(p: RosterPlayer, slot: SlotName) {
  if (slot === 'BN') return true
  if (slot === 'NA') return p.status.code === 'MINORS'
  return p.eligible.includes(slot)
}

const SLOT_OPTIONS: SlotName[] = ['IF', 'OF', 'UTIL', 'SP', 'RP', 'BN', 'NA']

function MoveSheet({ player, data, mine, onClose, onDone }: {
  player: RosterPlayer
  data: RosterResponse
  mine: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { leagueId } = useApp()
  const navigate = useNavigate()
  const [target, setTarget] = useState<SlotName | null>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const allowed = (s: SlotName) => s !== player.slot && canPlay(player, s)

  const move = async (moves: { playerId: number; slot: SlotName }[]) => {
    setError(null)
    try {
      await api.put(`/api/leagues/${leagueId}/roster/slots`, { moves })
      toast(`${player.name} 已移到 ${moves[0].slot}`)
      onDone()
    } catch (e) {
      setError(e)
    }
  }

  const choose = (s: SlotName) => {
    const occupants = data.players.filter((p) => p.slot === s)
    if (occupants.length < (data.slotCounts[s] ?? 0)) {
      move([{ playerId: player.playerId, slot: s }])
    } else {
      setTarget(s)
    }
  }

  const drop = async () => {
    try {
      const r = await api.post<{ effectiveDate: string }>(`/api/leagues/${leagueId}/roster/drop`, { playerId: player.playerId })
      toast(`${player.name} 已釋出，${fmtDate(r.effectiveDate)} 生效`)
      onDone()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <BottomSheet onClose={onClose} label={`調整 ${player.name}`}>
      <h3><TeamChip code={player.cpblTeam} />{player.name}<span className="ps">{player.eligible.join(',')}</span></h3>
      <ErrorBox error={error} />
      {mine && !target && !confirmDrop && (
        player.locked ? (
          <p className="ps" style={{ margin: 0 }}>今日比賽已開打，位置已鎖定，明天才能調整。</p>
        ) : (
          <>
            <p className="ps" style={{ margin: 0 }}>目前在 {player.slot}，移到：</p>
            <div className="slot-opts">
              {SLOT_OPTIONS.filter((s) => s !== player.slot && (s !== 'NA' || player.status.code === 'MINORS')).map((s) => (
                <button key={s} type="button" disabled={!allowed(s)} onClick={() => choose(s)}>
                  {s}<small>{s === 'BN' ? '板凳' : s === 'NA' ? '二軍名額' : allowed(s) ? '可移入' : '無資格'}</small>
                </button>
              ))}
            </div>
          </>
        )
      )}
      {target && (
        <>
          <p className="ps" style={{ margin: 0 }}>{target} 已滿，選一位交換到 {player.slot}：</p>
          {data.players.filter((p) => p.slot === target).map((p) => {
            const fits = canPlay(p, player.slot)
            return (
              <button key={p.playerId} type="button" className="btn-block" disabled={p.locked || !fits}
                onClick={() => move([{ playerId: player.playerId, slot: target }, { playerId: p.playerId, slot: player.slot }])}>
                {p.name}{p.locked ? '（已鎖定）' : !fits ? `（無 ${player.slot} 資格）` : ''}
              </button>
            )
          })}
          <button type="button" className="btn-block" onClick={() => setTarget(null)}>返回</button>
        </>
      )}
      {confirmDrop ? (
        <>
          <p className="ps" style={{ margin: 0 }}>確定釋出 {player.name}？釋出後進入 waiver 期，其他隊伍可以出價。</p>
          <div className="row2">
            <button type="button" className="danger" onClick={drop}>確定釋出</button>
            <button type="button" onClick={() => setConfirmDrop(false)}>取消</button>
          </div>
        </>
      ) : !target && (
        <>
          <button type="button" className="primary btn-block" onClick={() => navigate(`/players/${player.playerId}`)}>查看球員資料</button>
          <div className="row2">
            {mine ? <button type="button" className="danger" onClick={() => setConfirmDrop(true)}>釋出</button> : <span />}
            <button type="button" onClick={onClose}>關閉</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
