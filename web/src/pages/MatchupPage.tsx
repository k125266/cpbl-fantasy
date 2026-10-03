import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type CategoryResult, type Contribution, type Matchup } from '../api'
import { celebrate, ErrorBox, fmtDate, fmtDateTime, Loading, MATCHUP_STATUS, PlayerLink, TeamChip, useLoad } from '../components'

interface Detail {
  matchup: Matchup
  playersA?: Contribution[]
  playersB?: Contribution[]
}

function periodLabel(m: Matchup) {
  return m.kind === 'FINAL' ? '總冠軍賽' : `${m.halfNo === 1 ? '上' : '下'}半季 第 ${m.periodNo} 期`
}

export default function MatchupPage() {
  const { matchupId } = useParams()
  const { leagueId, league } = useApp()
  const list = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  if (list.loading && !list.data) return <Loading />
  if (list.error || !list.data) return <ErrorBox error={list.error} />
  const all = list.data
  const me = league?.myTeamId
  const mineAll = all.filter((m) => m.teamA === me || m.teamB === me)
  const defaultId = matchupId ? Number(matchupId)
    : (mineAll.find((m) => m.periodId === league?.currentPeriod?.id)
      ?? [...mineAll].reverse().find((m) => m.status !== 'PENDING')
      ?? mineAll[0])?.id

  const byPeriod = new Map<number, Matchup[]>()
  for (const m of all) {
    if (!byPeriod.has(m.periodId)) byPeriod.set(m.periodId, [])
    byPeriod.get(m.periodId)!.push(m)
  }

  return (
    <div className="stack">
      {defaultId ? <MatchupDetail id={defaultId} /> : <p className="muted">賽程尚未產生。</p>}
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
  )
}

function MatchupDetail({ id }: { id: number }) {
  const { leagueId, league } = useApp()
  const { data, error, loading } = useLoad(() => api.get<Detail>(`/api/leagues/${leagueId}/matchups/${id}`), [leagueId, id])
  const m = data?.matchup
  const me = league?.myTeamId
  const flip = m != null && m.teamB === me
  const myWin = m != null && m.result != null && (m.status === 'PROVISIONAL' || m.status === 'LOCKED')
    && ((m.result === 'A_WIN' && m.teamA === me) || (m.result === 'B_WIN' && m.teamB === me))

  useEffect(() => {
    if (!myWin || !m) return
    const key = `celebrated-${m.id}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      // 無法使用瀏覽器儲存時仍然播放一次
    }
    celebrate()
  }, [myWin, m])

  if (loading && !data) return <Loading />
  if (error || !data || !m) return <ErrorBox error={error} />

  // 以觀看者的隊伍為左側
  const L = flip ? { name: m.teamBName, score: m.scoreB, side: 'B' } : { name: m.teamAName, score: m.scoreA, side: 'A' }
  const R = flip ? { name: m.teamAName, score: m.scoreA, side: 'A' } : { name: m.teamBName, score: m.scoreB, side: 'B' }
  const ls = Number(L.score ?? 0)
  const rs = Number(R.score ?? 0)
  const leftLeads = ls > rs
  const tie = ls === rs
  const wins = m.categories.filter((c) => c.winner === (L.side as 'A' | 'B')).length
  const losses = m.categories.filter((c) => c.winner === (R.side as 'A' | 'B')).length
  const ties = m.categories.length - wins - losses
  const banner = (() => {
    if (m.status === 'PENDING') return '尚未開始'
    if (m.status === 'LIVE') return tie ? '本期暫時平手' : leftLeads ? '本期暫時領先' : '本期暫時落後'
    const word = tie ? '和局' : leftLeads ? '勝利' : '落敗'
    return m.status === 'PROVISIONAL' ? `暫定${word}・${fmtDateTime(m.locksAt)} 確定` : (leftLeads ? `🏆 本期${word}` : `本期${word}`)
  })()
  const total = ls + rs || 1
  const playersL = flip ? data.playersB : data.playersA
  const playersR = flip ? data.playersA : data.playersB

  return (
    <>
      <div className={`banner ${leftLeads || tie ? '' : 'silver'}`}>
        <div className="banner-top">{banner}</div>
        <div className="banner-body">
          <div className="mnames"><span className="me">{L.name ?? '待定'}{(m.teamA === me || m.teamB === me) && ' ◂'}</span><span>{R.name ?? '待定'}</span></div>
          <div className="mscore">
            <div className={`mini ${leftLeads || tie ? 'gold' : 'silver'}`}>{(L.name ?? '?').slice(0, 1)}</div>
            <div className={`s ${leftLeads || tie ? 'gold-text' : 'silver-text'}`}>{L.score ?? 0}</div>
            <div className="slash">/</div>
            <div className={`s ${!leftLeads || tie ? 'gold-text' : 'silver-text'}`}>{R.score ?? 0}</div>
            <div className={`mini ${!leftLeads || tie ? 'gold' : 'silver'}`}>{(R.name ?? '?').slice(0, 1)}</div>
          </div>
          <div className="mlabels">
            <b>{tie ? '平手' : leftLeads ? '領先' : '落後'}</b>
            <span>類別 {wins}–{losses}–{ties}</span>
            <span>{periodLabel(m)}</span>
          </div>
          <div className="mbar"><i className="ga" style={{ width: `${(ls / total) * 100}%` }} /><i className="gb" style={{ width: `${(rs / total) * 100}%` }} /></div>
        </div>
      </div>
      {m.note && <div className="alert info">{m.note}</div>}
      <div className="versus">
        {m.categories.map((c) => <VRow key={c.category} c={c} left={L.side as 'A' | 'B'} />)}
      </div>
      <p className="note" style={{ margin: 0 }}>每類別 1 分；平手或任一方無數據各得 0.5；總分 5:5 為和局。{fmtDate(m.start)} – {fmtDate(m.end)}</p>
      {playersL && <Contributions title={L.name ?? ''} players={playersL} />}
      {playersR && <Contributions title={R.name ?? ''} players={playersR} />}
    </>
  )
}

function VRow({ c, left }: { c: CategoryResult; left: 'A' | 'B' }) {
  const lv = left === 'A' ? c.a : c.b
  const rv = left === 'A' ? c.b : c.a
  const lw = c.winner === left
  const rw = c.winner !== 'TIE' && c.winner !== 'NO_DATA' && !lw
  return (
    <div className="vrow">
      <div className="vcell"><span className={`v ${lw ? 'win' : ''}`}>{lv}</span>{lw && <span className="crown">▲</span>}</div>
      <div className="vmid">{c.category}<small>{c.winner === 'TIE' ? '平手' : c.winner === 'NO_DATA' ? '無數據' : c.label}</small></div>
      <div className="vcell r"><span className={`v ${rw ? 'win' : ''}`}>{rv}</span>{rw && <span className="crown">▲</span>}</div>
    </div>
  )
}

function avg(h: number, ab: number) {
  return ab === 0 ? '—' : (h / ab).toFixed(3).replace(/^0/, '')
}
function era(er: number, outs: number) {
  return outs === 0 ? '—' : ((er * 27) / outs).toFixed(2)
}

function Contributions({ title, players }: { title: string; players: Contribution[] }) {
  const hitters = players.filter((p) => p.totals.ab > 0 || p.totals.r > 0 || p.totals.sb > 0)
  const pitchers = players.filter((p) => p.totals.outs > 0)
  return (
    <div className="card flush">
      <div className="listhead">{title}<small>本期先發貢獻</small></div>
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
