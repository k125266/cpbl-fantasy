import { useState } from 'react'
import { useApp } from '../App'
import { api, type PlayerRow, type RosterResponse } from '../api'
import { ErrorBox, fmtDateTime, Loading, PlayerLink, StatusBadge, TeamChip, useLoad } from '../components'

const HIT = ['R', 'HR', 'RBI', 'SB', 'AVG']
const PIT = ['QS', 'K', 'SV+HLD', 'ERA', 'WHIP']

export default function PlayersPage() {
  const { leagueId, league, reloadLeague } = useApp()
  const [q, setQ] = useState('')
  const [pos, setPos] = useState('')
  const [avail, setAvail] = useState('fa')
  const [range, setRange] = useState('season')
  const [sort, setSort] = useState('rank')
  const [action, setAction] = useState<PlayerRow | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const params = new URLSearchParams({ q, pos, avail, range, sort })
  const list = useLoad(() => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?${params}`), [leagueId, q, pos, avail, range, sort])
  const pitcherView = pos === 'SP' || pos === 'RP' || PIT.includes(sort)
  const cols = pitcherView ? PIT : HIT

  return (
    <>
      <h1>球員</h1>
      <div className="card">
        <div className="row">
          <input placeholder="搜尋姓名" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 120 }} />
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">全部位置</option>
            {['IF', 'OF', 'UTIL', 'SP', 'RP'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={avail} onChange={(e) => setAvail(e.target.value)}>
            <option value="fa">可簽入（FA / waiver）</option>
            <option value="rostered">已被持有</option>
            <option value="all">全部（含二軍 / 註銷）</option>
          </select>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="season">本季</option>
            <option value="14d">近 14 日</option>
            <option value="7d">近 7 日</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="rank">排名</option>
            {[...HIT, ...PIT].map((c) => <option key={c} value={c}>依 {c}</option>)}
          </select>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          排名僅採用當季數據（2026 起壘包加大與投球計時改變盜壘環境，不沿用往年數據）。
        </p>
      </div>
      {msg && <div className="alert info">{msg}</div>}
      {action && league?.myTeamId && (
        <AcquireDialog
          player={action}
          teamId={league.myTeamId}
          onClose={() => setAction(null)}
          onDone={(m) => {
            setMsg(m)
            setAction(null)
            list.reload()
            reloadLeague()
          }}
        />
      )}
      {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} />}
      {list.data && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>球員</th>
                  <th>位置</th>
                  {cols.map((c) => <th key={c} className="num">{c}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.playerId}>
                    <td className="num muted">{p.rank}</td>
                    <td>
                      <TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} />
                      {p.foreign && <span className="badge" style={{ marginLeft: 4 }}>洋</span>}
                      <div><StatusBadge status={p.status} /></div>
                    </td>
                    <td className="small">{p.eligible.join('/')}</td>
                    {cols.map((c) => <td key={c} className="num">{p.stats[c]}</td>)}
                    <td>
                      {p.ownerTeam ? (
                        <span className="muted small">{p.ownerTeam}</span>
                      ) : p.status.code === 'ACTIVE' || p.status.code === 'IDLE' ? (
                        <button className="small primary" onClick={() => setAction(p)}>{p.onWaivers ? '出價' : '簽入'}</button>
                      ) : null}
                      {p.onWaivers && <div className="small muted">W 至 {fmtDateTime(p.waiverClears)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function AcquireDialog({ player, teamId, onClose, onDone }: {
  player: PlayerRow
  teamId: number
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { leagueId } = useApp()
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${teamId}/roster`), [leagueId, teamId])
  const [drop, setDrop] = useState<string>('')
  const [bid, setBid] = useState(0)
  const [error, setError] = useState<unknown>(null)

  const submit = async () => {
    setError(null)
    try {
      const dropPlayerId = drop ? Number(drop) : null
      if (player.onWaivers) {
        await api.post(`/api/leagues/${leagueId}/waivers/claims`, { playerId: player.playerId, dropPlayerId, bid })
        onDone(`已對 ${player.name} 出價 ${bid} 點，將於 waiver 結算時處理`)
      } else {
        const r = await api.post<{ effectiveDate: string }>(`/api/leagues/${leagueId}/roster/add`, { playerId: player.playerId, dropPlayerId })
        onDone(`已簽入 ${player.name}，${r.effectiveDate} 生效`)
      }
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <h2>{player.onWaivers ? 'Waiver 出價' : '簽入自由球員'}：{player.name}</h2>
      <ErrorBox error={error} />
      {player.onWaivers && (
        <label>
          <span>FAAB 出價（剩餘 {roster.data?.faabBudget ?? '…'}；同價時戰績較差者優先）</span>
          <input type="number" min={0} max={roster.data?.faabBudget ?? 100} value={bid} onChange={(e) => setBid(Number(e.target.value))} />
        </label>
      )}
      <label>
        <span>同時釋出（名單已滿時必選）</span>
        <select value={drop} onChange={(e) => setDrop(e.target.value)}>
          <option value="">不釋出</option>
          {(roster.data?.players || []).map((p) => (
            <option key={p.playerId} value={p.playerId}>{p.slot} {p.name}{p.locked ? '（已鎖定，明日生效）' : ''}</option>
          ))}
        </select>
      </label>
      <p className="small muted">若相關球員今日比賽已開打，異動自明日起生效。</p>
      <div className="row">
        <button className="primary" onClick={submit}>確認</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  )
}
