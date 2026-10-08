import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type LiveGame, type LiveLine, type PostseasonView, type SeriesView } from '../api'
import { ErrorBox, Loading } from '../components'
import { useWide } from '../hooks'
import { ip } from '../live'
import {
  aggregate, avg, batText, bestBatter, bestPitcher, byOrder, eraText, leaderboards, linesOf,
  pitText, standingAfter, winnerOf, type BatAgg, type Board, type PitAgg,
} from '../postseason'
import SeriesCard from '../postseason/SeriesCard'
import TodayCard from '../postseason/TodayCard'
import { buildCtx, mdw } from '../postseason/shared'
import { TeamIcon } from '../teamIdentity'
import { cpblTeam, fantasyTeamColor } from '../teams'

/**
 * 季後賽專區（設計稿「台灣大賽專區」）：季後挑戰賽、台灣大賽的系列戰比分、今天這一戰、
 * 你的球員（只標示）、系列戰排行、每場戰況卡。季後賽不計入 fantasy，沒有預測、投票或計分。
 *
 * <p>數據取自即時快照（非最終數據）；沒有好壞球數、壘包與球場（資料源沒有），改顯示本半局出局數推算。
 */

const REFRESH = 60
const SERVED = (g: LiveGame) => g.status !== 'POSTPONED' && g.status !== 'CANCELLED'
const SER_HEADS_BAT = ['G', 'PA', 'AB', 'H', 'R', 'HR', 'BB', 'AVG']
const SER_HEADS_PIT = ['G', 'IP', 'H', 'BB', 'ER', 'K', '勝/救', 'ERA']

type Group = 'bat' | 'pit'

function clock(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function PostseasonPage() {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const [data, setData] = useState<PostseasonView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [upd, setUpd] = useState('')
  const [sec, setSec] = useState(REFRESH)
  const [kind, setKind] = useState<string | null>(null)
  const [group, setGroup] = useState<Group>('bat')
  const [recapIdx, setRecapIdx] = useState<number | null>(null)
  const [mineAll, setMineAll] = useState(false)

  const load = useCallback(() => {
    api.get<PostseasonView>(`/api/postseason?leagueId=${leagueId}`)
      .then((v) => { setData(v); setError(null); setUpd(clock(new Date())) })
      .catch(setError)
    setSec(REFRESH)
  }, [leagueId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const teams = useMemo(() => league?.teams ?? [], [league])
  const myTeam = teams.find((t) => t.id === data?.myTeamId) ?? null

  // 預設系列：已開打的最後一個；都還沒開打就是第一個
  const series: SeriesView | null = useMemo(() => {
    if (!data || data.series.length === 0) return null
    const started = data.series.filter((s) => s.games.some((g) => g.scheduledDate <= data.today))
    return data.series.find((s) => s.kind === kind) ?? started[started.length - 1] ?? data.series[0]
  }, [data, kind])

  // 今天還有比賽沒打完才每 60 秒自動更新
  const active = !!series && !!data && series.games.some((g) => g.playDate === data.today && SERVED(g) && g.status !== 'FINAL')
  useEffect(() => { if (active && sec === 0) load() }, [active, sec, load])

  if (error && !data) return <ErrorBox error={error} />
  if (!data) return <Loading />
  if (!series) {
    return (
      <div className="lv ps">
        <div className="lv-head"><div className="t"><div className="lv-kicker gold">POSTSEASON</div><h1>季後賽專區</h1></div></div>
        <div className="lv-empty box">季後賽還沒有賽程。季後挑戰賽、台灣大賽排定後，這裡會出現系列戰比分、每場戰況與排行（季後賽不計入 fantasy）。</div>
      </div>
    )
  }

  const s = series
  const ctx = buildCtx(data, s, teams)
  const games = [...s.games].sort(byOrder)
  const [tA, tB] = s.teams
  const team = (code: string) => cpblTeam(code)
  const isFinals = s.kind === 'C'
  const year = data.today.slice(0, 4)
  const todayGames = games.filter((g) => g.playDate === data.today && SERVED(g))
  const todayGame = todayGames.find((g) => g.status === 'IN_PROGRESS') ?? todayGames[todayGames.length - 1] ?? null
  const live = todayGame?.status === 'IN_PROGRESS'
  const finished = games.filter((g) => g.status === 'FINAL')
  const ring = `conic-gradient(var(--gold) ${Math.round((sec / REFRESH) * 360)}deg, var(--line) 0)`

  const mark = (fantasyTeamId: number | null, size = 13) => {
    if (fantasyTeamId == null || fantasyTeamId !== data.myTeamId || !myTeam) return null
    return <span className="ps-mine" title="你的球員" style={{ color: fantasyTeamColor(myTeam.id, teams) }}><TeamIcon icon={myTeam.icon} size={size} /></span>
  }
  const num = (code: string, jersey: string | null) => {
    const t = team(code)
    return <span className="ps-num" style={{ background: t.bg, color: t.fg }}>{jersey ?? ''}</span>
  }
  const chip = (code: string) => {
    const t = team(code)
    return <span className="chip" style={{ background: t.bg, color: t.fg }}>{t.short}</span>
  }

  // ---------------- 今天這一戰 ----------------
  const personRow = (label: string, l: LiveLine, text: string, tone: 'live' | 'best') => (
    <div className={`ps-person ${tone}`} key={label}>
      <span className="lab">{label}</span>
      {num(l.cpblTeam, l.jerseyNumber)}
      <div className="b">
        <div className="nm"><Link to={`/players/${l.playerId}`}>{l.name}</Link>{mark(l.fantasyTeamId)}<span className="ts">{team(l.cpblTeam).short}</span></div>
        <div className="tx">{text}</div>
      </div>
    </div>
  )

  /** 進行中的半局：官網的局數文字「五上」「七下」→ { inning: 5, top: true }；解析不了就不標 */
  const curHalf = (g: LiveGame): { i: number; top: boolean } | null => {
    if (g.status !== 'IN_PROGRESS' || !g.inning) return null
    const m = /^([一二三四五六七八九十]+)(上|下)/.exec(g.inning)
    if (!m) return null
    const d = '一二三四五六七八九'
    const n = m[1] === '十' ? 10 : m[1].startsWith('十') ? 10 + d.indexOf(m[1][1]) + 1 : m[1].endsWith('十') ? (d.indexOf(m[1][0]) + 1) * 10 : d.indexOf(m[1]) + 1
    return n > 0 ? { i: n - 1, top: m[2] === '上' } : null
  }

  const lineScore = (g: LiveGame, big = false) => {
    const ls = g.lineScore
    if (!ls) return null
    const cur = curHalf(g)
    return (
      <div className={`lv-ls${big ? ' big' : ''}`} role="table" aria-label="逐局比分">
        <div className="r h"><span />{ls.away.map((_, i) => <span key={i} className={cur && cur.i === i ? 'cur' : ''}>{i + 1}</span>)}<span>R</span><span>H</span><span>E</span></div>
        {[{ code: g.awayTeam, runs: ls.away, rhe: ls.awayRhe, top: true }, { code: g.homeTeam, runs: ls.home, rhe: ls.homeRhe, top: false }].map((x) => (
          <div key={x.code} className="r">
            <span className="t">{big ? <>{chip(x.code)}<em>{team(x.code).name}</em></> : team(x.code).short}</span>
            {x.runs.map((v, i) => <span key={i} className={cur && cur.top === x.top && cur.i === i ? 'cur' : ''}>{v ?? ''}</span>)}
            {x.rhe.map((v, i) => <span key={`t${i}`} className="tot">{v ?? ''}</span>)}
          </div>
        ))}
      </div>
    )
  }

  const todayScoreRows = (g: LiveGame) => [{ code: g.awayTeam, sc: g.awayScore, other: g.homeScore }, { code: g.homeTeam, sc: g.homeScore, other: g.awayScore }]
    .map(({ code, sc, other }) => {
      const t = team(code)
      const has = sc != null && other != null
      return (
        <div key={code} className={`lv-team${has && sc > other ? ' lead' : ''}${has && sc < other ? ' trail' : ''}`}>
          <span className="chip" style={{ background: t.bg, color: t.fg }}>{t.short}</span>
          <span className="nm">{t.name}</span>
          <span className="sc">{has ? sc : ''}</span>
        </div>
      )
    })

  // ---------------- 你的球員 ----------------
  const agg = aggregate(s.lines)
  const myBats = agg.bats.filter((x) => x.fantasyTeamId === data.myTeamId && data.myTeamId != null)
  const myPits = agg.pits.filter((x) => x.fantasyTeamId === data.myTeamId && data.myTeamId != null)
  const mineCount = myBats.length + myPits.length
  const todayLine = (id: number) => (todayGame ? linesOf(s, todayGame).find((l) => l.playerId === id) : undefined)
  const myCard = (p: BatAgg | PitAgg, isBat: boolean) => {
    const l = todayLine(p.playerId)
    const nowBat = !!todayGame && todayGame.status === 'IN_PROGRESS' && todayGame.batterId === p.playerId
    const nowPit = !!todayGame && todayGame.status === 'IN_PROGRESS' && todayGame.pitcherId === p.playerId
    const text = !todayGame ? '休息日，沒有比賽' : !l ? '今天沒有上場' : isBat ? batText(l) : pitText(l)
    const heads = isBat ? SER_HEADS_BAT : SER_HEADS_PIT
    const b = p as BatAgg, t = p as PitAgg
    const cells = isBat
      ? [b.g, b.pa, b.ab, b.h, b.r, b.hr, b.bb, avg(b.h, b.ab)]
      : [t.g, ip(t.outs), t.h, t.bb, t.er, t.k, `${t.w}/${t.sv}`, eraText(t)]
    return (
      <div key={`${isBat ? 'b' : 'p'}${p.playerId}`} className="ps-mycard">
        <div className="row1">
          {num(p.team, p.jersey)}
          <Link to={`/players/${p.playerId}`} className="n">{p.name}</Link>
          {mark(p.fantasyTeamId, 14)}
          <span className="ts">{team(p.team).short}・{p.pos}</span>
          <span className="sp" />
          {(nowBat || nowPit) && <span className="tag live">{nowBat ? '打擊中' : '投球中'}</span>}
        </div>
        <div className="row2"><span>{todayGame ? (live ? '今天・進行中' : '今天') : '今天'}</span><b>{text}</b></div>
        <div className="ps-cum">
          {heads.map((h) => <span key={h} className="h">{h}</span>)}
          {cells.map((v, i) => <span key={i} className="v">{v}</span>)}
        </div>
      </div>
    )
  }
  const minePanel = (
    <div className="ps-card">
      <div className="ps-ctitle"><span>你的球員</span><span className="sp" /><span className="muted">只標示，不計分</span></div>
      {mineCount === 0
        ? <div className="lv-empty">你的名單上沒有人在打{s.name}。</div>
        : (() => {
          // 名單上在打的人多時先收合，只列前 3 位
          const all = [...myBats.map((p) => ({ p, bat: true })), ...myPits.map((p) => ({ p, bat: false }))]
          const shown = mineAll ? all : all.slice(0, 3)
          return (
            <>
              {shown.map((x) => myCard(x.p, x.bat))}
              {all.length > 3 && (
                <button type="button" className="ps-more" onClick={() => setMineAll(!mineAll)}>{mineAll ? '收合' : `顯示全部 ${all.length} 位`}</button>
              )}
            </>
          )
        })()}
    </div>
  )

  // ---------------- 系列戰排行 ----------------
  const played = finished.length + (games.some((g) => g.status === 'IN_PROGRESS') ? 1 : 0)
  const boards = leaderboards(s.lines, Math.max(played, 1))
  const board = <T extends BatAgg | PitAgg>(b: Board<T>) => (
    <div key={b.key} className="ps-board">
      <div className="bh"><b>{b.title}</b><span className="k">{b.key}</span><span className="sp" /><span className="note">{b.note}</span></div>
      {b.rows.map((r) => (
        <div key={r.who.playerId} className="br">
          <span className="rk">{r.rank}</span>
          {num(r.who.team, r.who.jersey)}
          <div className="who">
            <div className="nm"><Link to={`/players/${r.who.playerId}`}>{r.who.name}</Link>{mark(r.who.fantasyTeamId, 12)}</div>
            <div className="sub">{team(r.who.team).short}・{r.sub}</div>
          </div>
          <span className="v">{r.value}</span>
        </div>
      ))}
      {b.rows.length === 0 && <div className="lv-empty">{b.emptyText || '還沒有數據'}</div>}
    </div>
  )
  const leadersPanel = (
    <div className="ps-card">
      <div className="ps-ctitle">
        <span>系列戰排行</span><span className="sp" />
        {!wide && (
          <div className="lv-seg" role="tablist">
            {([['bat', '打者'], ['pit', '投手']] as [Group, string][]).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={group === k} onClick={() => setGroup(k)}>{t}</button>
            ))}
          </div>
        )}
        {wide && <span className="muted">{live ? '含進行中的比賽・非最終' : `${played} 場累計`}</span>}
      </div>
      {(wide || group === 'bat') && <div className="ps-boards">{wide && <div className="gt">打者</div>}{boards.bat.map((b) => board(b))}</div>}
      {(wide || group === 'pit') && <div className="ps-boards">{wide && <div className="gt">投手</div>}{boards.pit.map((b) => board(b))}</div>}
    </div>
  )

  // ---------------- 戰況卡 ----------------
  const recapGames = finished
  const ri = Math.min(recapIdx ?? recapGames.length - 1, recapGames.length - 1)
  const recapCard = (g: LiveGame) => {
    const lines = linesOf(s, g)
    const i = games.indexOf(g)
    const w = winnerOf(g)
    const after = standingAfter(s, games, i)
    const b = bestBatter(lines), p = bestPitcher(lines)
    return (
      <div key={g.id} className={`ps-card ps-recap${g === todayGame ? ' today' : ''}`}>
        <div className="rh">
          <b>第 {i + 1} 戰</b><span className="m">{mdw(g.scheduledDate)}</span><span className="sp" />
          <span className="res"><i style={{ background: w ? team(w).bg : 'transparent' }} />{w ? `${team(w).short}勝` : '和局'}</span>
        </div>
        <div className="ps-rscore">{todayScoreRows(g)}</div>
        <div className="rls">{lineScore(g)}</div>
        {b && personRow('最佳打者', b, batText(b), 'best')}
        {p && personRow('最佳投手', p, pitText(p), 'best')}
        <div className="after">第 {i + 1} 戰後 {team(tA).short} {after[tA]}：{after[tB]} {team(tB).short}</div>
      </div>
    )
  }
  const recaps = (
    <>
      <div className="lv-label"><span>戰況卡 · 已打 {recapGames.length} 場</span><span className="muted">{wide ? '新的在前' : '點場次往回看'}</span></div>
      {recapGames.length === 0 && <div className="lv-empty box">第一場結束後，這裡會出現戰況卡：比分、逐局、本場最佳打者與投手。</div>}
      {!wide && recapGames.length > 0 && (
        <>
          <div className="ps-chips">
            {recapGames.map((g, k) => (
              <button key={g.id} type="button" className={k === ri ? 'on' : ''} onClick={() => setRecapIdx(k)}>第 {games.indexOf(g) + 1} 戰</button>
            ))}
          </div>
          {recapCard(recapGames[ri])}
        </>
      )}
      {wide && <div className="ps-recaps">{[...recapGames].reverse().map(recapCard)}</div>}
    </>
  )

  // ---------------- 頁首 ----------------
  const anyLive = data.series.some((x) => x.games.some((g) => g.status === 'IN_PROGRESS'))
  const format = `${s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0) === 7 ? '七戰四勝' : `${s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0)} 戰${s.winsNeeded} 勝`}`
  const header = (
    <div className="pv-head">
      <div className="t">
        {live || anyLive
          ? <div className="pv-kick"><i />LIVE · 非最終數據</div>
          : <div className="pv-kick gold">{isFinals ? `TAIWAN SERIES · ${year}` : `POSTSEASON · ${year}`}</div>}
        <div className="pv-title">
          <h1>{s.name}專區</h1>
          <span className="sub">{wide ? `${mdw(data.today)}・` : ''}{format}・季後賽不計入 fantasy</span>
        </div>
      </div>
      {active && (
        <div className="pv-refresh">
          <div className="txt"><div><b>{sec}</b> 秒後更新</div><small>上次 {upd}</small></div>
          <button type="button" className="lv-ring" style={{ background: ring }} title="立即更新" aria-label={`${sec} 秒後更新，點一下立即更新`} onClick={load}>
            <span><b>{sec}</b><small>秒</small><i className="ico">↻</i></span>
          </button>
        </div>
      )}
    </div>
  )
  const switcher = data.series.length > 1 && (
    <div className="lv-seg pv-switch" role="tablist">
      {data.series.map((x) => (
        <button key={x.kind} type="button" role="tab" aria-selected={x.kind === s.kind} onClick={() => { setKind(x.kind); setRecapIdx(null) }}>{x.name}</button>
      ))}
    </div>
  )

  return (
    <div className="lv ps pv">
      {header}
      {switcher}
      <SeriesCard ctx={ctx} />
      <TodayCard ctx={ctx} />
      <div className="pv-two">{minePanel}{leadersPanel}</div>
      {recaps}
      <p className="lv-note">{data.notice}</p>
    </div>
  )
}
