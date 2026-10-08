import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Matchup, type PostseasonView, type StandingRow } from '../api'
import { ErrorBox, ICONS, Loading, useLoad } from '../components'
import { deriveCards, loadSeen } from '../postseason/cards'

interface Standings {
  half1: StandingRow[]
  half2: StandingRow[]
  championTeamId: number | null
  championNote: string | null
}

/** 連勝 / 連敗：依已有結果的對戰由新到舊計算。 */
function streakOf(teamId: number, ms: Matchup[]): { n: number; win: boolean } | null {
  const done = ms.filter((m) => m.result && (m.status === 'PROVISIONAL' || m.status === 'LOCKED') && (m.teamA === teamId || m.teamB === teamId))
    .sort((a, b) => b.start.localeCompare(a.start))
  let n = 0
  let win: boolean | null = null
  for (const m of done) {
    if (m.result === 'TIE') break
    const w = (m.result === 'A_WIN') === (m.teamA === teamId)
    if (win === null) win = w
    if (w !== win) break
    n++
  }
  return win === null ? null : { n, win }
}

export default function LeagueHubPage() {
  const { leagueId, league, user } = useApp()
  const st = useLoad(() => api.get<Standings>(`/api/leagues/${leagueId}/standings`), [leagueId])
  const ms = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  // 季後賽專區的入口：有季後賽賽程才出現（錯誤時當作沒有，不影響聯盟首頁）
  const post = useLoad(() => api.get<PostseasonView>(`/api/postseason?leagueId=${leagueId}`).catch(() => null), [leagueId])
  // 季後賽專區入口的提示：還沒打開的紀念卡張數（看過的卡存在這個瀏覽器）
  const newCards = post.data ? (() => {
    const seen = loadSeen(leagueId, user.id)
    return deriveCards(post.data, post.data.myTeamId, '').flat.filter((c) => !seen.has(c.id)).length
  })() : 0
  const [half, setHalf] = useState<1 | 2>((league?.currentPeriod?.halfNo as 1 | 2) ?? 1)
  if (st.loading && !st.data) return <Loading />
  if (st.error || !st.data) return <ErrorBox error={st.error} />
  const me = league?.myTeamId
  const rows = half === 1 ? st.data.half1 : st.data.half2
  const halves = league?.halves ?? []
  const champ = st.data.championTeamId ? league?.teams.find((t) => t.id === st.data!.championTeamId) : null
  const matchups = ms.data || []

  const myMatchups = matchups.filter((m) => m.result && (m.teamA === me || m.teamB === me) && (m.status === 'PROVISIONAL' || m.status === 'LOCKED'))
  const myWins = myMatchups.filter((m) => (m.result === 'A_WIN') === (m.teamA === me) && m.result !== 'TIE')
  const shutout = myWins.some((m) => Number(m.teamA === me ? m.scoreA : m.scoreB) === 10)
  const myStreak = me ? streakOf(me, matchups) : null
  const trophies: [string, boolean, 'gold' | 'silver'][] = [
    ['首場勝利', myWins.length > 0, 'silver'],
    ['三連勝', !!myStreak && myStreak.win && myStreak.n >= 3, 'gold'],
    ['10:0 完封', shutout, 'gold'],
    ['上半季冠軍', halves.find((h) => h.halfNo === 1)?.championTeamId === me, 'gold'],
    ['下半季冠軍', halves.find((h) => h.halfNo === 2)?.championTeamId === me, 'gold'],
    ['年度總冠軍', st.data.championTeamId === me, 'gold'],
  ]

  return (
    <div className="stack">
      {champ && <div className="banner"><div className="banner-top">🏆 年度總冠軍：{champ.name}</div><div className="banner-body" style={{ paddingBottom: 12 }}><span className="ps">{st.data.championNote}</span></div></div>}

      <div className="hub">
        <Link to="/transactions">{ICONS.swap}Waiver・交易</Link>
        <Link to="/live">{ICONS.live}即時比分</Link>
        {post.data && post.data.series.length > 0 && (
          <Link to="/postseason" className="hub-post">
            {ICONS.trophy}季後賽專區
            {newCards > 0
              ? <i className="hub-count" aria-label={`${newCards} 張新紀念卡`}>{newCards}</i>
              : post.data.series.some((s) => s.games.some((g) => g.status === 'IN_PROGRESS')) && <i className="hub-dot" aria-label="比賽進行中" />}
          </Link>
        )}
        <Link to="/league/settings">{ICONS.gear}聯盟設定</Link>
        {user.admin && <Link to="/admin">{ICONS.server}系統管理</Link>}
        <Link to="/privacy">{ICONS.shield}隱私・資料來源</Link>
      </div>

      <div className="h2">戰績
        <div className="seg" role="group" aria-label="半季">
          <button type="button" aria-pressed={half === 1} onClick={() => setHalf(1)}>上半季</button>
          <button type="button" aria-pressed={half === 2} onClick={() => setHalf(2)}>下半季</button>
        </div>
      </div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ textAlign: 'center' }}>#</th><th>隊伍</th><th className="num">勝</th><th className="num">敗</th><th className="num">和</th><th className="num">得分</th><th>近況</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = streakOf(r.teamId, matchups.filter((m) => m.halfNo === half))
                return (
                  <tr key={r.teamId} className={r.teamId === me ? 'me' : ''}>
                    <td style={{ textAlign: 'center' }}><span className={`medal ${r.rank <= 3 ? `m${r.rank}` : 'mx'}`}>{r.rank}</span></td>
                    <td style={{ fontWeight: 700 }}><Link to={`/teams/${r.teamId}`} style={{ color: 'var(--text)' }}>{r.teamName}</Link>{r.provisional > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>含暫定</span>}</td>
                    <td className="num">{r.wins}</td><td className="num">{r.losses}</td><td className="num">{r.ties}</td>
                    <td className="num">{r.pointsFor}</td>
                    <td>{s && s.n > 0 && <span className={`streak ${s.win ? 'w' : 'l'}`}>{s.win ? '連勝' : '連敗'} {s.n}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="note" style={{ margin: 0 }}>排名依勝率（和局計半勝），再依類別總得分。兩位半季冠軍進行總冠軍賽。</p>

      <div className="h2">獎盃櫃 <small>{trophies.filter((t) => t[1]).length} / {trophies.length}</small></div>
      <div className="card trophies">
        {trophies.map(([label, got, metal]) => (
          <div key={label} className={`trophy ${got ? metal : ''}`}>
            <div className="ic">{label.includes('冠軍') ? ICONS.trophy : ICONS.star}</div>{label}
          </div>
        ))}
      </div>
    </div>
  )
}
