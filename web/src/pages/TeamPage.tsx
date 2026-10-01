import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Matchup, type RosterPlayer, type RosterResponse, type SlotName, type StandingRow } from '../api'
import { Avatar, BottomSheet, ErrorBox, fmtDate, fmtTime, Loading, TeamChip, toast, useLoad, weekday } from '../components'
import { cpblTeam } from '../teams'

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
  const st = (halfNo === 2 ? standings.data?.half2 : standings.data?.half1)?.find((r) => r.teamId === id)
  const current = (matchups.data || []).find((m) => m.periodId === data.period?.id && (m.teamA === id || m.teamB === id))
  const myScore = current ? (current.teamA === id ? current.scoreA : current.scoreB) : null

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
    <div className="stack">
      <div className="teamhead">
        <div className="crest"><div>{(team?.abbr ?? data.teamName).slice(0, 1)}</div></div>
        <div style={{ minWidth: 0 }}>
          <div className="teamname">{data.teamName}</div>
          <div className="teamsub">
            {st && <><span className="num">{st.wins}-{st.losses}-{st.ties}</span>・第 {st.rank} 名・</>}{team?.owner}
          </div>
        </div>
        <div className="bigpts">
          <span className="num gold-text">{myScore ?? '–'}</span>
          <small>本期類別分</small>
        </div>
      </div>

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
