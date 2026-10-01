import { Link, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Contribution, type Matchup } from '../api'
import { ErrorBox, fmtDate, fmtDateTime, Loading, MATCHUP_STATUS, PlayerLink, TeamChip, useLoad } from '../components'

interface Detail {
  matchup: Matchup
  playersA?: Contribution[]
  playersB?: Contribution[]
}

export default function MatchupPage() {
  const { matchupId } = useParams()
  return matchupId ? <MatchupDetail id={Number(matchupId)} /> : <MatchupList />
}

function MatchupList() {
  const { leagueId, league } = useApp()
  const { data, error, loading } = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const byPeriod = new Map<number, Matchup[]>()
  for (const m of data || []) {
    if (!byPeriod.has(m.periodId)) byPeriod.set(m.periodId, [])
    byPeriod.get(m.periodId)!.push(m)
  }
  return (
    <>
      <h1>對戰</h1>
      {[...byPeriod.entries()].map(([pid, ms]) => {
        const m0 = ms[0]
        return (
          <div className="card" key={pid}>
            <div className="spread">
              <h2 style={{ margin: 0 }}>
                {m0.kind === 'FINAL' ? '總冠軍賽' : `${m0.halfNo === 1 ? '上' : '下'}半季 第 ${m0.periodNo} 期`}
              </h2>
              <span className="muted small">{fmtDate(m0.start)} – {fmtDate(m0.end)}</span>
            </div>
            <ul className="list-plain">
              {ms.map((m) => (
                <li key={m.id}>
                  <Link to={`/matchups/${m.id}`} className="spread" style={{ color: 'inherit' }}>
                    <span style={{ fontWeight: m.teamA === league?.myTeamId || m.teamB === league?.myTeamId ? 700 : 400 }}>
                      {m.teamAName ?? '待定'} vs {m.teamBName ?? '待定'}
                    </span>
                    <span className="row">
                      {m.scoreA != null && <span>{m.scoreA} : {m.scoreB}</span>}
                      <span className={`badge ${MATCHUP_STATUS[m.status].cls}`}>{m.status === 'PROVISIONAL' ? '暫定' : MATCHUP_STATUS[m.status].text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

function MatchupDetail({ id }: { id: number }) {
  const { leagueId } = useApp()
  const { data, error, loading } = useLoad(() => api.get<Detail>(`/api/leagues/${leagueId}/matchups/${id}`), [leagueId, id])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox error={error} />
  const m = data.matchup
  const st = MATCHUP_STATUS[m.status]
  return (
    <>
      <p><Link to="/matchups">← 所有對戰</Link></p>
      <div className="card">
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
          {m.kind === 'FINAL' ? '總冠軍賽' : `${m.halfNo === 1 ? '上' : '下'}半季 第 ${m.periodNo} 期`}・{fmtDate(m.start)} – {fmtDate(m.end)}
        </p>
        <div className="scoreline" style={{ marginTop: 8 }}>
          <div className="name">{m.teamAName ?? '待定'}</div>
          <div className="score">{m.scoreA ?? 0} : {m.scoreB ?? 0}</div>
          <div className="name">{m.teamBName ?? '待定'}</div>
        </div>
        <p style={{ textAlign: 'center' }}>
          <span className={`badge ${st.cls}`}>{st.text}</span>
        </p>
        {m.status === 'PROVISIONAL' && (
          <div className="alert warn">
            暫定結果：對戰期結束後 48 小時內（至 {fmtDateTime(m.locksAt)}），官方記錄修正仍可能改變勝負。
          </div>
        )}
        {m.note && <div className="alert info">{m.note}</div>}
        <div className="cat-grid">
          {m.categories.map((c) => (
            <Row key={c.category} c={c} />
          ))}
        </div>
        <p className="small muted">每類別 1 分；平手或任一方無數據（分母為零）各得 0.5 分；總分 5:5 為和局。</p>
      </div>
      {data.playersA && <Contributions title={m.teamAName ?? ''} players={data.playersA} />}
      {data.playersB && <Contributions title={m.teamBName ?? ''} players={data.playersB} />}
    </>
  )
}

function Row({ c }: { c: Detail['matchup']['categories'][number] }) {
  const nd = c.winner === 'NO_DATA'
  return (
    <>
      <div className={`a ${c.winner === 'A' ? 'win' : ''} ${nd ? 'nodata' : ''}`}>{c.a}</div>
      <div className="label">{c.category}<br /><span className="small">{nd ? '無數據' : c.label}</span></div>
      <div className={`b ${c.winner === 'B' ? 'win' : ''} ${nd ? 'nodata' : ''}`}>{c.b}</div>
    </>
  )
}

function avg(h: number, ab: number) {
  return ab === 0 ? '—' : (h / ab).toFixed(3).replace(/^0/, '')
}
function era(er: number, outs: number) {
  return outs === 0 ? '—' : ((er * 27) / outs).toFixed(2)
}
function whip(h: number, bb: number, outs: number) {
  return outs === 0 ? '—' : (((h + bb) * 3) / outs).toFixed(2)
}

function Contributions({ title, players }: { title: string; players: Contribution[] }) {
  const { leagueId } = useApp()
  const hitters = players.filter((p) => p.totals.ab > 0 || p.totals.r > 0 || p.totals.sb > 0)
  const pitchers = players.filter((p) => p.totals.outs > 0)
  return (
    <div className="card">
      <h2>{title}・先發貢獻</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>打者</th><th className="num">AB</th><th className="num">H</th><th className="num">R</th><th className="num">HR</th><th className="num">RBI</th><th className="num">SB</th><th className="num">AVG</th></tr>
          </thead>
          <tbody>
            {hitters.map((p) => (
              <tr key={p.playerId}>
                <td><TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} /></td>
                <td className="num">{p.totals.ab}</td><td className="num">{p.totals.h}</td><td className="num">{p.totals.r}</td>
                <td className="num">{p.totals.hr}</td><td className="num">{p.totals.rbi}</td><td className="num">{p.totals.sb}</td>
                <td className="num">{avg(p.totals.h, p.totals.ab)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr><th>投手</th><th className="num">IP</th><th className="num">QS</th><th className="num">K</th><th className="num">SV+HLD</th><th className="num">ERA</th><th className="num">WHIP</th></tr>
          </thead>
          <tbody>
            {pitchers.map((p) => (
              <tr key={p.playerId}>
                <td><TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} /></td>
                <td className="num">{Math.floor(p.totals.outs / 3)}.{p.totals.outs % 3}</td>
                <td className="num">{p.totals.qs}</td><td className="num">{p.totals.k}</td><td className="num">{p.totals.sv + p.totals.hld}</td>
                <td className="num">{era(p.totals.er, p.totals.outs)}</td><td className="num">{whip(p.totals.pH, p.totals.pBb, p.totals.outs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
