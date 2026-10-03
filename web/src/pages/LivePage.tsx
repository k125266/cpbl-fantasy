import { useEffect } from 'react'
import { useApp } from '../App'
import { api } from '../api'
import { ErrorBox, fmtTime, Loading, TeamChip, useLoad } from '../components'

interface Game {
  id: number
  game_sno: number
  scheduled_date: string
  actual_play_date: string | null
  play_date: string
  start_time: string | null
  home_team_code: string
  away_team_code: string
  status: string
  home_score: number | null
  away_score: number | null
  stats_final: boolean
  live_home_score: number | null
  live_away_score: number | null
  inning_text: string | null
  fetched_at: string | null
}

interface Line {
  team_id: number
  abbr: string
  slot: string
  player_id: number
  name: string
  cpbl_team_code: string
  pa: number; ab: number; h: number; hr: number; r: number; bb: number
  pitched: boolean; outs: number; p_h: number; p_bb: number; p_er: number; p_k: number; sv: number; w: number
  fetched_at: string
}

export default function LivePage() {
  const { leagueId, league } = useApp()
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ notice: string; games: Game[]; lines: Line[] }>(`/api/live?leagueId=${leagueId}`),
    [leagueId],
  )
  useEffect(() => {
    const t = setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [reload])
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} />
  const starters = data.lines.filter((l) => !['BN', 'NA'].includes(l.slot))
  return (
    <>
      <h1>即時比分</h1>
      <div className="alert live">⚠ {data.notice}</div>
      <div className="card">
        <h2>今日賽事</h2>
        <ul className="list-plain">
          {data.games.map((g) => {
            const live = g.status === 'IN_PROGRESS'
            const movedAway = g.play_date !== league?.today
            const postponed = g.status === 'POSTPONED'
            return (
              <li key={g.id} className="spread">
                <span className="row">
                  <TeamChip code={g.away_team_code} />
                  <b>{live ? g.live_away_score ?? '-' : g.away_score ?? ''}</b>
                  <span className="muted">@</span>
                  <TeamChip code={g.home_team_code} />
                  <b>{live ? g.live_home_score ?? '-' : g.home_score ?? ''}</b>
                </span>
                <span className="small">
                  {g.status === 'FINAL' ? <span className="badge ok">比賽結束{g.stats_final ? '・數據已定版' : ''}</span>
                    : live ? <span className="badge live">進行中 {g.inning_text ?? ''}（非最終）</span>
                      : postponed ? <span className="badge warn">延賽・待補賽</span>
                        : movedAway ? <span className="badge warn">延賽，改至 {g.play_date} 補賽</span>
                        : <span className="muted">{fmtTime(g.start_time)}</span>}
                  {!movedAway && g.actual_play_date && g.actual_play_date !== g.scheduled_date && <span className="muted"> 補賽（原定 {g.scheduled_date}）</span>}
                </span>
              </li>
            )
          })}
          {data.games.length === 0 && <li className="muted">今日無比賽（中職通常週一休兵，可自由調整名單）</li>}
        </ul>
      </div>
      <div className="card" style={{ borderStyle: 'dashed' }}>
        <h2>聯盟先發球員即時數據 <span className="badge live">非最終數據</span></h2>
        {starters.length === 0 && <p className="muted small">目前沒有進行中的比賽數據。</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>隊</th><th>球員</th><th>打擊</th><th>投球</th></tr></thead>
            <tbody>
              {starters.map((l) => (
                <tr key={`${l.team_id}-${l.player_id}`}>
                  <td>{l.abbr}</td>
                  <td><TeamChip code={l.cpbl_team_code} /> {l.name} <span className="muted small">{l.slot}</span></td>
                  <td className="small">{l.pa > 0 ? `${l.h}-${l.ab} R${l.r} HR${l.hr} BB${l.bb}` : ''}</td>
                  <td className="small">{l.pitched ? `${Math.floor(l.outs / 3)}.${l.outs % 3} IP ${l.p_er} ER ${l.p_k} K${l.w ? ' W' : ''}${l.sv ? ' SV' : ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">即時數據每 60 秒更新，僅供參考。正式對戰比分只採用賽後結算的數據，兩者可能不同。</p>
      </div>
    </>
  )
}
