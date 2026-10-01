import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Matchup, type Notification } from '../api'
import { fmtDate, fmtDateTime, MATCHUP_STATUS, useLoad } from '../components'

export default function HomePage() {
  const { leagueId, league } = useApp()
  const matchups = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  const notes = useLoad(() => api.get<Notification[]>(`/api/leagues/${leagueId}/notifications`), [leagueId])
  if (!league) return null
  const myTeam = league.teams.find((t) => t.id === league.myTeamId)
  const period = league.currentPeriod
  const mine = (matchups.data || []).filter(
    (m) => (period ? m.periodId === period.id : false) && (m.teamA === league.myTeamId || m.teamB === league.myTeamId),
  )
  const champion = league.league.championTeamId ? league.teams.find((t) => t.id === league.league.championTeamId) : null

  const markRead = async () => {
    await api.post(`/api/leagues/${leagueId}/notifications/read`)
    notes.reload()
  }

  return (
    <>
      <h1>{league.league.name}</h1>
      {champion && (
        <div className="alert info">🏆 年度總冠軍：{champion.name}（{league.league.championNote}）</div>
      )}
      {myTeam?.lineupLockReason && <div className="alert error">名單已鎖定：{myTeam.lineupLockReason} <Link to="/roster">前往處理</Link></div>}
      <div className="card">
        <div className="spread">
          <h2>{myTeam?.name}</h2>
          <span className="muted small">FAAB 剩餘 {myTeam?.faabBudget}</span>
        </div>
        {period ? (
          <p className="small muted">
            {period.kind === 'FINAL' ? '總冠軍賽' : `${period.halfNo === 1 ? '上' : '下'}半季第 ${period.periodNo} 期`}：
            {fmtDate(period.startDate)} – {fmtDate(period.endDate)}
          </p>
        ) : (
          <p className="small muted">目前不在對戰期內（今日 {league.today}）</p>
        )}
        {mine.length === 0 && period && <p>本期輪空。</p>}
        {mine.map((m) => {
          const meA = m.teamA === league.myTeamId
          return (
            <Link key={m.id} to={`/matchups/${m.id}`} className="scoreline" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="name">{meA ? m.teamAName : m.teamBName}</div>
              <div className="score">{meA ? m.scoreA ?? 0 : m.scoreB ?? 0} : {meA ? m.scoreB ?? 0 : m.scoreA ?? 0}</div>
              <div className="name">{(meA ? m.teamBName : m.teamAName) ?? '待定'}</div>
            </Link>
          )
        })}
        {mine.map((m) => (
          <p key={`s${m.id}`} className="small" style={{ textAlign: 'center' }}>
            <span className={`badge ${MATCHUP_STATUS[m.status].cls}`}>{MATCHUP_STATUS[m.status].text}</span>
          </p>
        ))}
      </div>
      <div className="card">
        <div className="spread">
          <h2>通知</h2>
          <button className="small" onClick={markRead}>全部已讀</button>
        </div>
        <ul className="list-plain">
          {(notes.data || []).slice(0, 15).map((n) => (
            <li key={n.id} style={{ fontWeight: n.read ? 400 : 600 }}>
              {n.message} <span className="muted small">{fmtDateTime(n.createdAt)}</span>
            </li>
          ))}
          {notes.data && notes.data.length === 0 && <li className="muted">沒有通知</li>}
        </ul>
      </div>
    </>
  )
}
