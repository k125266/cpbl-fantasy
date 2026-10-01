import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { ALL_SLOTS, api, type RosterPlayer, type RosterResponse, type SlotName } from '../api'
import { ErrorBox, fmtDate, fmtTime, Loading, PlayerLink, StatusBadge, TeamChip, useLoad } from '../components'

const SLOT_LABEL: Record<SlotName, string> = {
  IF: '內野', OF: '外野', UTIL: 'UTIL', SP: '先發投', RP: '後援投', BN: '板凳', NA: 'NA',
}

interface Seat {
  slot: SlotName
  player: RosterPlayer | null
}

export default function RosterPage() {
  const { teamId } = useParams()
  const { leagueId, league, reloadLeague } = useApp()
  const id = teamId ? Number(teamId) : league?.myTeamId
  const mine = id === league?.myTeamId
  const { data, error, loading, reload } = useLoad(
    () => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${id}/roster`),
    [leagueId, id],
  )
  const [selected, setSelected] = useState<RosterPlayer | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (!id) return <p>找不到隊伍</p>
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} />

  // 依 slot 排列，未填滿的先發 / 板凳 / NA 位置以空位呈現
  const seats: Seat[] = []
  for (const s of ALL_SLOTS) {
    const ps = data.players.filter((p) => p.slot === s)
    ps.forEach((p) => seats.push({ slot: s, player: p }))
    const empty = Math.max(0, (data.slotCounts[s] ?? 0) - ps.length)
    for (let i = 0; i < empty; i++) seats.push({ slot: s, player: null })
  }
  const foreignCount = data.players.filter((p) => p.foreign).length
  const rostered = data.players.filter((p) => p.slot !== 'NA').length

  const submit = async (moves: { playerId: number; slot: SlotName }[]) => {
    setBusy(true)
    setActionError(null)
    try {
      await api.put(`/api/leagues/${leagueId}/roster/slots`, { moves })
      setSelected(null)
      reload()
      reloadLeague()
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
    }
  }

  const clickSeat = (seat: Seat) => {
    if (!mine || busy) return
    if (!selected) {
      if (seat.player) setSelected(seat.player)
      return
    }
    if (seat.player?.playerId === selected.playerId) {
      setSelected(null)
      return
    }
    if (seat.player) {
      submit([
        { playerId: selected.playerId, slot: seat.slot },
        { playerId: seat.player.playerId, slot: selected.slot },
      ])
    } else {
      submit([{ playerId: selected.playerId, slot: seat.slot }])
    }
  }

  const drop = async (p: RosterPlayer) => {
    if (!confirm(`確定釋出 ${p.name}？釋出後將進入 waiver 期。`)) return
    try {
      const r = await api.post<{ effectiveDate: string }>(`/api/leagues/${leagueId}/roster/drop`, { playerId: p.playerId })
      alert(`已釋出，${fmtDate(r.effectiveDate)} 生效`)
      setSelected(null)
      reload()
      reloadLeague()
    } catch (e) {
      setActionError(e)
    }
  }

  const canTarget = (seat: Seat) => {
    if (!selected) return true
    if (seat.slot === 'BN') return true
    if (seat.slot === 'NA') return selected.status.code === 'MINORS'
    return selected.eligible.includes(seat.slot)
  }

  return (
    <>
      <div className="spread">
        <h1>{data.teamName}</h1>
        {!mine && league && <Link to="/roster">回我的名單</Link>}
      </div>
      <p className="small muted">
        {data.today} 名單・{rostered}/{data.rosterSize} 人（不含 NA）・洋將 {foreignCount}/{data.foreignLimit}・FAAB {data.faabBudget}
        {data.period && <> ・本期 {fmtDate(data.period.startDate)}–{fmtDate(data.period.endDate)}</>}
      </p>
      {data.lineupLockReason && <div className="alert error">名單鎖定中：{data.lineupLockReason}</div>}
      <ErrorBox error={actionError} />
      {mine && (
        <div className="alert info small">
          {selected
            ? <>已選取 <b>{selected.name}</b>，點選目標位置或球員以交換（可用位置：{selected.eligible.join('/') || '無'}・BN）。 <button className="small" onClick={() => setSelected(null)}>取消</button> <button className="small danger" onClick={() => drop(selected)}>釋出</button></>
            : <>點選球員後再點選目標位置即可調整。球員所屬球隊當日開賽後即鎖定，無法移動。</>}
        </div>
      )}
      <div className="card" style={{ padding: '4px 14px' }}>
        {seats.map((seat, i) => {
          const p = seat.player
          const isSel = selected && p && p.playerId === selected.playerId
          const targetable = selected && !isSel && canTarget(seat)
          return (
            <div
              key={i}
              className={`slot-row ${p?.status.code === 'DELISTED' ? 'delisted' : ''}`}
              onClick={() => clickSeat(seat)}
              style={{
                cursor: mine ? 'pointer' : 'default',
                outline: isSel ? '2px solid var(--accent)' : targetable ? '1px dashed var(--accent)' : undefined,
                opacity: selected && !isSel && !targetable ? 0.45 : 1,
              }}
            >
              <div className="slot-tag" title={SLOT_LABEL[seat.slot]}>{seat.slot}</div>
              {p ? (
                <div>
                  <div className="row" style={{ gap: 6 }}>
                    <TeamChip code={p.cpblTeam} />
                    <span className="pname" onClick={(e) => e.stopPropagation()}>
                      <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} />
                    </span>
                    {p.foreign && <span className="badge">洋</span>}
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="meta">
                    {p.eligible.join(' / ') || '—'}
                    {p.game ? <> ・{p.game.home ? 'vs' : '@'} <TeamChip code={p.game.opponent} /> {gameText(p)}</> : ' ・今日無比賽'}
                    {p.pendingFrom && <> ・<b>{fmtDate(p.pendingFrom)} 生效</b></>}
                    {p.leavingOn && <> ・<b>{fmtDate(p.leavingOn)} 離隊</b></>}
                  </div>
                  {p.period && (
                    <div className="meta">
                      本期：{p.slot === 'SP' || p.slot === 'RP' || p.listedPosition === 'P'
                        ? `IP ${p.period.IP} K ${p.period.K} ERA ${p.period.ERA} WHIP ${p.period.WHIP} QS ${p.period.QS} SV+HLD ${p.period['SV+HLD']}`
                        : `${p.period.H}/${p.period.AB} R ${p.period.R} HR ${p.period.HR} RBI ${p.period.RBI} SB ${p.period.SB}`}
                    </div>
                  )}
                </div>
              ) : (
                <div className="muted small">（空）</div>
              )}
              <div>{p?.locked && <span className="badge lock">鎖定</span>}</div>
            </div>
          )
        })}
      </div>
      <p className="small muted">
        NA 僅限下二軍球員，不佔名單額度；球員重新登錄一軍後次日自動移至板凳。已註銷球員於次日自動釋出。
      </p>
    </>
  )
}

function gameText(p: RosterPlayer) {
  if (!p.game) return ''
  switch (p.game.status) {
    case 'FINAL': return '已結束'
    case 'IN_PROGRESS': return '進行中'
    case 'SUSPENDED': return '保留比賽'
    case 'POSTPONED': return '延賽'
    default: return fmtTime(p.game.startTime)
  }
}
