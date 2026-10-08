import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type LiveGame, type LiveLine, type PostseasonView, type SeriesView } from '../api'
import { ErrorBox, fmtTime, Loading } from '../components'
import { useWide } from '../hooks'
import { ip, OUTS_HINT, outsOf } from '../live'
import {
  aggregate, avg, batText, bestBatter, bestPitcher, byOrder, eraText, isBatLine, isPitLine, leaderboards, linesOf,
  maxGames, pitText, standingAfter, winnerOf, type BatAgg, type Board, type PitAgg,
} from '../postseason'
import { TeamIcon } from '../teamIdentity'
import { cpblTeam, fantasyTeamColor } from '../teams'

/**
 * 季後賽專區（設計稿「台灣大賽專區」）：季後挑戰賽、台灣大賽的系列戰比分、今天這一戰、
 * 你的球員（只標示）、系列戰排行、每場戰況卡。季後賽不計入 fantasy，沒有預測、投票或計分。
 *
 * <p>數據取自即時快照（非最終數據）；沒有好壞球數、壘包與球場（資料源沒有），改顯示本半局出局數推算。
 */

const REFRESH = 60
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const SERVED = (g: LiveGame) => g.status !== 'POSTPONED' && g.status !== 'CANCELLED'
const BAT_HEADS = ['PA', 'AB', 'H', 'R', 'HR', 'BB']
const PIT_HEADS = ['IP', 'H', 'BB', 'ER', 'K', '勝/救']
const SER_HEADS_BAT = ['G', 'PA', 'AB', 'H', 'R', 'HR', 'BB', 'AVG']
const SER_HEADS_PIT = ['G', 'IP', 'H', 'BB', 'ER', 'K', '勝/救', 'ERA']

type Tab = 'all' | 'away' | 'home'
type Group = 'bat' | 'pit'

function clock(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** "2026-10-17" → "10/17 週六" */
function mdw(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d} 週${WEEK[new Date(y, m - 1, d).getDay()]}`
}

export default function PostseasonPage() {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const [data, setData] = useState<PostseasonView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [upd, setUpd] = useState('')
  const [sec, setSec] = useState(REFRESH)
  const [kind, setKind] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [group, setGroup] = useState<Group>('bat')
  const [recapIdx, setRecapIdx] = useState<number | null>(null)

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
  const games = [...s.games].sort(byOrder)
  const [tA, tB] = s.teams
  const team = (code: string) => cpblTeam(code)
  const isFinals = s.kind === 'C'
  const year = data.today.slice(0, 4)
  const todayGames = games.filter((g) => g.playDate === data.today && SERVED(g))
  const todayGame = todayGames.find((g) => g.status === 'IN_PROGRESS') ?? todayGames[todayGames.length - 1] ?? null
  const live = todayGame?.status === 'IN_PROGRESS'
  const todayNo = todayGame ? games.indexOf(todayGame) + 1 : null
  const upcoming = games.filter((g) => g.status === 'SCHEDULED' && g !== todayGame)
  const nextGame = upcoming[0] ?? null
  const lastFinal = [...games].reverse().find((g) => g.status === 'FINAL') ?? null
  const finished = games.filter((g) => g.status === 'FINAL')
  const decided = s.winner != null
  const ring = `conic-gradient(var(--gold) ${Math.round((sec / REFRESH) * 360)}deg, var(--line) 0)`
  const noOf = (g: LiveGame) => games.indexOf(g) + 1

  const lead = (() => {
    const a = s.wins[tA] ?? 0, b = s.wins[tB] ?? 0
    if (decided) return `${team(s.winner as string).short}${isFinals ? '奪冠' : '晉級'}`
    return a === b ? '系列戰平手' : `${team(a > b ? tA : tB).short}領先`
  })()
  const advantageNote = s.advantageTeam ? `（${team(s.advantageTeam).short}保送 1 勝）` : ''

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

  // ---------------- 系列戰卡 ----------------
  const stripCell = (i: number) => {
    const g = games[i]
    if (!g) {
      const t = decided ? '未舉行' : '若需要'
      return { key: `x${i}`, top: `第 ${i + 1} 戰`, meta: '', main: '—', mainDim: true, tag: t, dot: 'transparent', flag: '', cls: '' }
    }
    const meta = mdw(g.scheduledDate)
    const isToday = g.playDate === data.today
    if (g.status === 'FINAL') {
      const w = winnerOf(g)
      const hi = Math.max(g.homeScore ?? 0, g.awayScore ?? 0), lo = Math.min(g.homeScore ?? 0, g.awayScore ?? 0)
      return { key: g.id, top: `第 ${i + 1} 戰`, meta, main: `${hi}:${lo}`, mainDim: false, tag: w ? `${team(w).short}勝` : '和局', dot: w ? team(w).bg : 'transparent', flag: isToday ? '今天' : '', cls: isToday ? 'today' : '' }
    }
    if (g.status === 'IN_PROGRESS') {
      const sc = (c: string) => (c === g.homeTeam ? g.homeScore : g.awayScore) ?? 0
      return { key: g.id, top: `第 ${i + 1} 戰`, meta, main: `${sc(tA)}:${sc(tB)}`, mainDim: false, tag: `進行中・${g.inning ?? ''}`, dot: '#ff4d4f', flag: '今天', cls: 'live' }
    }
    const isNext = g === nextGame && !todayGame
    return { key: g.id, top: `第 ${i + 1} 戰`, meta, main: g.startTime ? fmtTime(g.startTime) : '—', mainDim: false, tag: g.status === 'POSTPONED' ? '延賽' : '', dot: 'transparent', flag: isNext ? '下一戰' : '', cls: isNext ? 'next' : '' }
  }
  const slots = Math.max(maxGames(s), games.length)

  const statusText = (() => {
    if (decided) {
      const w = s.winner as string, o = w === tA ? tB : tA
      return `${team(w).short}以 ${s.wins[w]}：${s.wins[o]} ${isFinals ? `奪得 ${year} 總冠軍` : '晉級台灣大賽'}`
    }
    if (live && todayNo) return `第 ${todayNo} 戰進行中`
    if (todayGame && todayGame.status === 'FINAL' && todayNo) {
      const w = winnerOf(todayGame)
      return `第 ${todayNo} 戰 ${w ? `${team(w).short}獲勝` : '平手'}。` + (nextGame ? `下一戰 第 ${noOf(nextGame)} 戰 ${mdw(nextGame.scheduledDate)}${nextGame.startTime ? ` ${fmtTime(nextGame.startTime)}` : ''}` : '')
    }
    if (nextGame) return `今天休息。第 ${noOf(nextGame)} 戰 ${mdw(nextGame.scheduledDate)}${nextGame.startTime ? ` ${fmtTime(nextGame.startTime)}` : ''} 開打`
    return '還沒有排定的比賽'
  })()

  const seriesCard = (
    <div className="ps-card ps-series">
      <div className="ps-score">
        <div className="side">{chip(tA)}<span className="nm">{team(tA).name}</span></div>
        <div className="big">
          <span className={(s.wins[tA] ?? 0) >= (s.wins[tB] ?? 0) ? '' : 'trail'}>{s.wins[tA] ?? 0}</span>
          <i>:</i>
          <span className={(s.wins[tB] ?? 0) >= (s.wins[tA] ?? 0) ? '' : 'trail'}>{s.wins[tB] ?? 0}</span>
        </div>
        <div className="side r">{chip(tB)}<span className="nm">{team(tB).name}</span></div>
      </div>
      <div className="ps-lead">{lead}・先拿 {s.winsNeeded} 勝{isFinals ? '奪冠' : '晉級'}{advantageNote}</div>
      <div className="ps-strip">
        {Array.from({ length: slots }, (_, i) => stripCell(i)).map((c) => (
          <div key={c.key} className={`ps-cell ${c.cls}`}>
            <div className="top"><span>{c.top}</span><em>{c.flag}</em></div>
            <div className={`main${c.mainDim ? ' dim' : ''}`}>{c.main}</div>
            <div className="tag"><i style={{ background: c.dot }} />{c.tag}</div>
            <div className="meta">{c.meta}</div>
          </div>
        ))}
      </div>
      <div className="ps-status">{statusText}</div>
    </div>
  )

  // ---------------- 今天這一戰 ----------------
  const sideRows = (g: LiveGame, home: boolean) => linesOf(s, g).filter((l) => l.home === home)
  const boxTable = (g: LiveGame, home: boolean) => {
    const rows = sideRows(g, home)
    const bats = rows.filter(isBatLine), pits = rows.filter(isPitLine)
    const nameBits = (l: LiveLine) => (
      <div className="who">
        <Link to={`/players/${l.playerId}`} className="n">{l.name}</Link>
        {mark(l.fantasyTeamId)}
        <span className="pos">{l.listedPosition}</span>
        {g.batterId === l.playerId && <span className="tag live">打擊中</span>}
        {g.pitcherId === l.playerId && <span className="tag live">投球中</span>}
      </div>
    )
    const cell = (v: number | string, hi?: boolean) => <span className={`r${v === 0 || v === '–' ? ' dim' : hi ? ' gold' : ''}`}>{v}</span>
    return (
      <div className="ps-box">
        <div className="ps-boxhead"><span /><span>打者</span>{BAT_HEADS.map((h) => <span key={h} className="r">{h}</span>)}</div>
        {bats.map((l) => (
          <div key={l.playerId} className={`ps-boxrow${l.fantasyTeamId === data.myTeamId && data.myTeamId != null ? ' me' : ''}`}>
            {num(l.cpblTeam, l.jerseyNumber)}{nameBits(l)}
            {[l.pa, l.ab, l.h, l.r].map((v, i) => <Fragment key={i}>{cell(v)}</Fragment>)}{cell(l.hr, true)}{cell(l.bb)}
          </div>
        ))}
        {bats.length === 0 && <div className="lv-empty">還沒有打者數據</div>}
        <div className="ps-boxhead"><span /><span>投手</span>{PIT_HEADS.map((h) => <span key={h} className="r">{h}</span>)}</div>
        {pits.map((l) => (
          <div key={l.playerId} className={`ps-boxrow${l.fantasyTeamId === data.myTeamId && data.myTeamId != null ? ' me' : ''}`}>
            {num(l.cpblTeam, l.jerseyNumber)}{nameBits(l)}
            <span className="r">{ip(l.outs)}</span>{cell(l.pH)}{cell(l.pBb)}{cell(l.pEr)}{cell(l.pK)}
            <span className={`r${l.w || l.sv ? ' gold' : ' dim'}`}>{l.w ? 'W' : l.sv ? 'SV' : '–'}</span>
          </div>
        ))}
        {pits.length === 0 && <div className="lv-empty">還沒有投手數據</div>}
      </div>
    )
  }

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

  const lineScore = (g: LiveGame) => {
    const ls = g.lineScore
    if (!ls) return null
    return (
      <div className="lv-ls" role="table" aria-label="逐局比分">
        <div className="r h"><span />{ls.away.map((_, i) => <span key={i}>{i + 1}</span>)}<span>R</span><span>H</span><span>E</span></div>
        {[{ code: g.awayTeam, runs: ls.away, rhe: ls.awayRhe }, { code: g.homeTeam, runs: ls.home, rhe: ls.homeRhe }].map((x) => (
          <div key={x.code} className="r">
            <span className="t">{team(x.code).short}</span>
            {x.runs.map((v, i) => <span key={i}>{v ?? ''}</span>)}
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

  const todayInfo = (g: LiveGame) => {
    if (g.status === 'IN_PROGRESS') {
      const outs = outsOf(g)
      return { inn: g.inning ?? '進行中', sub: outs == null ? '進行中・非最終' : `${outs} 出局・非最終`, live: true }
    }
    if (g.status === 'FINAL') return { inn: '終場', sub: `${winnerOf(g) ? team(winnerOf(g) as string).short + '勝' : '平手'}・比賽結束`, live: false }
    return { inn: g.startTime ? fmtTime(g.startTime) : '—', sub: '尚未開始', live: false }
  }

  const todayBody = (g: LiveGame) => {
    const lines = linesOf(s, g)
    const batter = g.batterId != null ? lines.find((l) => l.playerId === g.batterId) : undefined
    const pitcher = g.pitcherId != null ? lines.find((l) => l.playerId === g.pitcherId) : undefined
    if (tab !== 'all') return boxTable(g, tab === 'home')
    return (
      <>
        <div className="lv-detail">
          {lineScore(g)}
          {g.halfInning && g.halfInning.length > 0 && (
            <div className="lv-half">
              <span className="lab" title={OUTS_HINT}>本半局・{outsOf(g)} 出局</span>
              {g.halfInning.map((pa, i) => <span key={i} className={pa.result == null ? 'now' : ''}>{i > 0 && <em>→</em>}{pa.name} {pa.result ?? '對決中'}</span>)}
            </div>
          )}
        </div>
        {g.status === 'IN_PROGRESS' && (
          <>
            {batter && personRow('打擊中', batter, `今天 ${batter.ab} 打數 ${batter.h} 安` + (batter.bb ? ` ${batter.bb} 保送` : ''), 'live')}
            {pitcher && personRow('投球中', pitcher, `今天 ${ip(pitcher.outs)} 局 ${pitcher.pH} 安 ${pitcher.pK} K` + (pitcher.pEr ? ` 失 ${pitcher.pEr} 分` : ''), 'live')}
          </>
        )}
        {g.status === 'FINAL' && (() => {
          const b = bestBatter(lines), p = bestPitcher(lines)
          return <>{b && personRow('最佳打者', b, batText(b), 'best')}{p && personRow('最佳投手', p, pitText(p), 'best')}</>
        })()}
        {g.sourceUrl && <a className="lv-src ps-src" href={g.sourceUrl} target="_blank" rel="noopener noreferrer">到進階數據網站看這場 ↗</a>}
      </>
    )
  }

  const restCard = (
    <div className="ps-rest">
      <div className="h">{decided ? '系列戰已結束' : '今天休息'}</div>
      <p>
        {decided
          ? `${team(s.winner as string).short}${isFinals ? `奪得 ${year} 總冠軍` : '晉級台灣大賽'}。每一戰的戰況在下方。`
          : nextGame
            ? `第 ${noOf(nextGame)} 戰 ${mdw(nextGame.scheduledDate)}${nextGame.startTime ? ` ${fmtTime(nextGame.startTime)}` : ''} 開打。`
            : '下一戰還沒有排定。'}
      </p>
      {!decided && nextGame && (
        <div className="ps-next">
          {chip(nextGame.awayTeam)}<span className="m">客</span>
          <b>{nextGame.startTime ? fmtTime(nextGame.startTime) : '—'}</b>
          <span className="m">主</span>{chip(nextGame.homeTeam)}
        </div>
      )}
      {lastFinal && <p className="m">前一戰：第 {noOf(lastFinal)} 戰 {winnerOf(lastFinal) ? `${team(winnerOf(lastFinal) as string).short}獲勝` : '平手'} {Math.max(lastFinal.homeScore ?? 0, lastFinal.awayScore ?? 0)}：{Math.min(lastFinal.homeScore ?? 0, lastFinal.awayScore ?? 0)}，戰況卡在下方。</p>}
    </div>
  )

  const tabs: { k: Tab; t: string }[] = todayGame
    ? [{ k: 'all', t: '全場' }, { k: 'away', t: team(todayGame.awayTeam).short }, { k: 'home', t: team(todayGame.homeTeam).short }]
    : []
  const todayCard = (
    <div className="ps-card">
      <div className="ps-ctitle">
        <span>今天這一戰{todayNo ? ` · 第 ${todayNo} 戰` : ''}</span>
        {live && <span className="lv-badge">非最終數據</span>}
        <span className="sp" />
        {todayGame && (
          <div className="lv-seg" role="tablist">
            {tabs.map((x) => <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)}>{x.t}</button>)}
          </div>
        )}
      </div>
      {todayGame ? (
        <>
          <div className="lv-ghead">
            <div className="teams">{todayScoreRows(todayGame)}</div>
            <div className={`state${todayInfo(todayGame).live ? ' live' : ''}`}>
              <span className="inn">{todayInfo(todayGame).live && <i />}{todayInfo(todayGame).inn}</span>
              <span className="sub">{todayInfo(todayGame).sub}</span>
            </div>
          </div>
          {todayBody(todayGame)}
        </>
      ) : restCard}
    </div>
  )

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
        : <>{myBats.map((p) => myCard(p, true))}{myPits.map((p) => myCard(p, false))}</>}
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
  const header = (
    <div className="lv-head">
      <div className="t">
        {live || anyLive
          ? <div className="lv-kicker"><i />LIVE · 非最終數據</div>
          : <div className="lv-kicker gold">{isFinals ? `TAIWAN SERIES · ${year}` : `POSTSEASON · ${year}`}</div>}
        <h1>{s.name}專區</h1>
        <div className="upd">
          {s.winsNeeded === 4 ? '七戰四勝' : `${s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0)} 戰${s.winsNeeded} 勝`}・季後賽不計入 fantasy
          {active && <>・上次更新 {upd}</>}
        </div>
      </div>
      {active && (
        <button type="button" className="lv-ring" style={{ background: ring }} title="立即更新" aria-label={`${sec} 秒後更新，點一下立即更新`} onClick={load}>
          <span><b>{sec}</b><small>秒</small></span>
        </button>
      )}
    </div>
  )
  const switcher = data.series.length > 1 && (
    <div className="lv-seg ps-switch" role="tablist">
      {data.series.map((x) => (
        <button key={x.kind} type="button" role="tab" aria-selected={x.kind === s.kind} onClick={() => { setKind(x.kind); setTab('all'); setRecapIdx(null) }}>{x.name}</button>
      ))}
    </div>
  )

  return (
    <div className="lv ps">
      {header}
      {switcher}
      {seriesCard}
      <div className="ps-cols">
        <div className="ps-main">{todayCard}</div>
        <div className="ps-side">{minePanel}{leadersPanel}</div>
      </div>
      {recaps}
      <p className="lv-note">{data.notice}</p>
    </div>
  )
}
