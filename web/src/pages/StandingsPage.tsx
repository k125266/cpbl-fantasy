import { useApp } from '../App'
import { api, type Half, type StandingRow } from '../api'
import { ErrorBox, Loading, useLoad } from '../components'

interface Resp {
  half1: StandingRow[]
  half2: StandingRow[]
  halves: Half[]
  championTeamId: number | null
  championNote: string | null
}

export default function StandingsPage() {
  const { leagueId, league } = useApp()
  const { data, error, loading } = useLoad(() => api.get<Resp>(`/api/leagues/${leagueId}/standings`), [leagueId])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox error={error} />
  const champ = data.championTeamId ? league?.teams.find((t) => t.id === data.championTeamId) : null
  return (
    <>
      <h1>戰績</h1>
      {champ && <div className="alert info">🏆 年度總冠軍：{champ.name}（{data.championNote}）</div>}
      {[1, 2].map((h) => {
        const half = data.halves.find((x) => x.halfNo === h)
        const rows = h === 1 ? data.half1 : data.half2
        const hc = half?.championTeamId ? league?.teams.find((t) => t.id === half.championTeamId) : null
        return (
          <div className="card" key={h}>
            <div className="spread">
              <h2>{h === 1 ? '上' : '下'}半季</h2>
              {hc && <span className="badge ok">半季冠軍：{hc.name}</span>}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th className="num">#</th><th>隊伍</th><th className="num">勝</th><th className="num">敗</th><th className="num">和</th><th className="num">勝率</th><th className="num">得分</th><th className="num">失分</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.teamId}>
                      <td className="num">{r.rank}</td>
                      <td>{r.teamName} <span className="muted small">{r.owner}</span>{r.provisional > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>含暫定</span>}</td>
                      <td className="num">{r.wins}</td><td className="num">{r.losses}</td><td className="num">{r.ties}</td>
                      <td className="num">{r.pct.toFixed(3)}</td><td className="num">{r.pointsFor}</td><td className="num">{r.pointsAgainst}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <p className="small muted">
        排名依勝率（和局計半勝），再依類別總得分。兩位半季冠軍於季末進行總冠軍賽；同一隊包辦上下半季則直接獲得年度總冠軍。
      </p>
    </>
  )
}
