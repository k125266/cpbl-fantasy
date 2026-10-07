import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type LiveGame, type LiveLine, type LiveStarter, type LiveView, type TeamView } from '../api'
import { ErrorBox, fmtTime, Loading } from '../components'
import { useWide } from '../hooks'
import { TeamIcon } from '../teamIdentity'
import { cpblTeam, fantasyTeamColor } from '../teams'

/**
 * 即時比分（設計稿「即時比分與通知」1a 手機、1b 網頁）。
 *
 * <p>以當天中職比賽為主體：每場一張卡，列出這場有出賽的人，依客隊、主隊分開。
 * 「我的隊／對戰／全聯盟」只列 fantasy 先發（BN、NA 不算）；「全場」列這場所有上場球員，依棒次與登板順序。
 * 進行中的數據為即時快照（非最終），結算後改為正式數據；已結束的比賽繼續留在頁面上。
 */

type Mode = 'mine' | 'vs' | 'all' | 'full'
const MODES: { k: Mode; t: string }[] = [
  { k: 'full', t: '全場' }, { k: 'mine', t: '我的隊' }, { k: 'vs', t: '對戰' }, { k: 'all', t: '全聯盟' },
]
const REFRESH = 60
const PLAYING = (g: LiveGame) => g.status !== 'POSTPONED' && g.status !== 'CANCELLED'
const BAT_HEADS = ['PA', 'AB', 'H', 'R', 'HR', 'BB']
const PIT_HEADS = ['IP', 'H', 'BB', 'ER', 'K', '勝/救']

function clock(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`

/** 畫面上的一列：上場球員（line）或還沒上場的先發（line 為 null） */
interface Row {
  key: string
  playerId: number
  name: string
  slot: string
  pos: string
  isBat: boolean
  sub: boolean
  line: LiveLine | null
  team: TeamView | null
  fresh: boolean
  batting: boolean
  pitching: boolean
}

interface Side {
  code: string
  label: string
  bats: Row[]
  pits: Row[]
}

function tokens(l: LiveLine): { t: string; c?: string }[] {
  if (l.batted && l.pa > 0) {
    const out: { t: string; c?: string }[] = [{ t: `${l.h}-${l.ab}` }]
    if (l.r) out.push({ t: `R${l.r}`, c: 'mid' })
    if (l.hr) out.push({ t: `HR${l.hr}`, c: 'gold' })
    if (l.bb) out.push({ t: `BB${l.bb}`, c: 'mid' })
    return out
  }
  if (l.pitched) {
    const out: { t: string; c?: string }[] = [{ t: `${ip(l.outs)} IP` }, { t: `${l.pEr} ER`, c: 'mid' }, { t: `${l.pK} K`, c: 'mid' }]
    if (l.w) out.push({ t: 'W', c: 'gold' })
    if (l.sv) out.push({ t: 'SV', c: 'gold' })
    return out
  }
  return [{ t: '0-0', c: 'dim' }]
}

function cells(r: Row): { v: string | number; c?: string }[] {
  const l = r.line
  if (!l) return Array.from({ length: 6 }, () => ({ v: '–', c: 'dim' }))
  const v = (x: number, hi?: boolean) => ({ v: x, c: x === 0 ? 'dim' : hi ? 'gold' : undefined })
  if (r.isBat) return [v(l.pa), v(l.ab), v(l.h), v(l.r), v(l.hr, true), v(l.bb)]
  return [{ v: ip(l.outs) }, v(l.pH), v(l.pBb), v(l.pEr), v(l.pK), { v: l.w ? 'W' : l.sv ? 'SV' : '–', c: l.w || l.sv ? 'gold' : 'dim' }]
}

/** 官網沒有出局數，從本半局的打席結果代碼推算；盜壘刺、牽制出局不在打席結果裡，可能少算 */
const OUTS_HINT = '出局數依本半局打席結果推算，不含盜壘刺與牽制出局'
function outsOf(g: LiveGame): number | null {
  if (!g.halfInning || g.halfInning.length === 0) return null
  let n = 0
  for (const { result: r } of g.halfInning) {
    if (r == null) continue
    if (r === '三殺') n += 3
    else if (r === '雙殺') n += 2
    else if (r === '三振' || r === '犧短' || r === '犧飛' || /^[投捕一二三游左中右](飛|滾|平|界飛|短)$/.test(r)) n += 1
  }
  return Math.min(n, 3)
}

/** 官網賽事代碼的名稱（台灣大賽的代碼公布後補上） */
const KIND_NAME: Record<string, string> = { E: '季後挑戰賽' }

function gameState(g: LiveGame, lines: LiveLine[]): { inn: string; sub: string; live: boolean } {
  switch (g.status) {
    case 'IN_PROGRESS': {
      const outs = outsOf(g)
      return { inn: g.inning ?? '進行中', sub: outs == null ? '進行中・非最終' : `${outs} 出局・非最終`, live: true }
    }
    case 'FINAL': {
      // 季後賽不結算，不會有「結算中 → 比賽結束」的變化
      if (g.postseason) return { inn: '終', sub: '比賽結束・不計分', live: false }
      const settled = lines.some((l) => l.gameId === g.id && l.settled)
      return { inn: '終', sub: g.statsFinal ? '數據已定版' : settled ? '比賽結束' : '比賽結束・結算中', live: false }
    }
    case 'POSTPONED':
      return { inn: '延賽', sub: '待補賽', live: false }
    case 'SUSPENDED':
      return { inn: '保留', sub: '保留比賽', live: false }
    case 'CANCELLED':
      return { inn: '取消', sub: '比賽取消', live: false }
    default:
      return { inn: g.startTime ? fmtTime(g.startTime) : '—', sub: '尚未開始', live: false }
  }
}

export default function LivePage() {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const [data, setData] = useState<LiveView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [upd, setUpd] = useState('')
  const [sec, setSec] = useState(REFRESH)
  const [mode, setMode] = useState<Mode>('full')
  const [selId, setSelId] = useState<number | null>(null)

  const load = useCallback(() => {
    api.get<LiveView>(`/api/live?leagueId=${leagueId}`)
      .then((v) => { setData(v); setError(null); setUpd(clock(new Date())) })
      .catch(setError)
    setSec(REFRESH)
  }, [leagueId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { if (sec === 0) load() }, [sec, load])

  const teams = useMemo(() => league?.teams ?? [], [league])
  const teamOf = useCallback((id: number | null) => (id == null ? null : teams.find((t) => t.id === id) ?? null), [teams])

  if (error && !data) return <ErrorBox error={error} />
  if (!data) return <Loading />

  const keys = new Set<number>(
    mode === 'mine' ? [data.myTeamId].filter((x): x is number => x != null)
      : mode === 'vs' ? [data.myTeamId, data.opponentTeamId].filter((x): x is number => x != null)
        : teams.map((t) => t.id))
  const starterOf = (s: LiveStarter) => keys.has(s.fantasyTeamId)
  const isStarterLine = (l: LiveLine) => l.fantasyTeamId != null && keys.has(l.fantasyTeamId) && l.rosterSlot != null
    && l.rosterSlot !== 'BN' && l.rosterSlot !== 'NA'

  const playingTeams = new Set(data.games.filter(PLAYING).flatMap((g) => [g.homeTeam, g.awayTeam]))

  const toRow = (g: LiveGame, l: LiveLine): Row => {
    const full = mode === 'full'
    const fresh = !l.settled && g.status === 'IN_PROGRESS' && !!l.changedAt && !!g.fetchedAt
      && new Date(l.changedAt).getTime() >= new Date(g.fetchedAt).getTime() - 2000
    return {
      key: `${g.id}-${l.playerId}`, playerId: l.playerId, name: l.name,
      slot: full ? (l.batted ? (l.lineupSlot != null ? String(l.lineupSlot) : '') : 'P') : (l.rosterSlot ?? ''),
      pos: l.listedPosition, isBat: l.batted || !l.pitched, sub: full && l.sub, line: l, team: teamOf(l.fantasyTeamId),
      fresh, batting: g.batterId === l.playerId, pitching: g.pitcherId === l.playerId,
    }
  }
  const notYetRow = (g: LiveGame, s: LiveStarter): Row => ({
    key: `${g.id}-s${s.playerId}`, playerId: s.playerId, name: s.name, slot: s.rosterSlot, pos: s.listedPosition,
    isBat: s.rosterSlot !== 'SP' && s.rosterSlot !== 'RP', sub: false, line: null, team: teamOf(s.fantasyTeamId),
    fresh: false, batting: false, pitching: false,
  })

  const sidesOf = (g: LiveGame): Side[] => [
    { code: g.awayTeam, label: '客隊', home: false },
    { code: g.homeTeam, label: '主隊', home: true },
  ].map(({ code, label, home }) => {
    const lines = data.lines.filter((l) => l.gameId === g.id && l.home === home && (mode === 'full' || isStarterLine(l)))
    const rows = lines.map((l) => toRow(g, l))
    if (mode !== 'full' && PLAYING(g) && g.status !== 'FINAL') {
      const appeared = new Set(data.lines.filter((l) => l.gameId === g.id).map((l) => l.playerId))
      data.starters.filter((s) => starterOf(s) && s.cpblTeam === code && !appeared.has(s.playerId))
        .forEach((s) => rows.push(notYetRow(g, s)))
    }
    return { code, label, bats: rows.filter((r) => r.isBat), pits: rows.filter((r) => !r.isBat) }
  }).filter((s) => s.bats.length + s.pits.length > 0)

  // 我的先發摘要
  const mine = data.starters.filter((s) => s.fantasyTeamId === data.myTeamId)
  const appearedToday = new Set(data.lines.map((l) => l.playerId))
  const played = mine.filter((s) => appearedToday.has(s.playerId)).length
  const waiting = mine.filter((s) => !appearedToday.has(s.playerId) && playingTeams.has(s.cpblTeam)).length
  const off = mine.length - played - waiting
  const noGame = mode === 'full' ? [] : data.starters.filter((s) => starterOf(s) && !playingTeams.has(s.cpblTeam))
  const offTeams = Object.keys({ BRO: 1, UNI: 1, RAK: 1, FUB: 1, WEI: 1, TSG: 1 }).filter((c) => !playingTeams.has(c))
  const countIn = (g: LiveGame, teamId: number | null) => teamId == null ? 0 : data.starters
    .filter((s) => s.fantasyTeamId === teamId && (s.cpblTeam === g.homeTeam || s.cpblTeam === g.awayTeam)).length

  const sel = data.games.find((g) => g.id === selId) ?? data.games.find((g) => g.status === 'IN_PROGRESS') ?? data.games[0]
  const emptyText = mode === 'mine' ? '這場沒有你的先發' : mode === 'vs' ? '這場沒有你或對手的先發' : mode === 'all' ? '這場沒有聯盟任何隊的先發' : '這場還沒有數據'
  const ring = `conic-gradient(var(--gold) ${Math.round((sec / REFRESH) * 360)}deg, var(--line) 0)`

  const seg = (
    <div className="lv-seg" role="tablist">
      {MODES.map((m) => (
        <button key={m.k} type="button" role="tab" aria-selected={mode === m.k} onClick={() => setMode(m.k)}>{m.t}</button>
      ))}
    </div>
  )

  const summary = (
    <>
      <div className="lv-sum">
        <div><b>{played}</b><span>出賽中</span></div>
        <div><b className="mid">{waiting}</b><span>尚未上場</span></div>
        <div><b className="muted">{off}</b><span>今日無比賽</span></div>
      </div>
      <div className="lv-mine">我的先發 {mine.length} 人</div>
    </>
  )

  const scoreRows = (g: LiveGame) => {
    const hasScore = g.homeScore != null && g.awayScore != null
    return [{ code: g.awayTeam, sc: g.awayScore, other: g.homeScore }, { code: g.homeTeam, sc: g.homeScore, other: g.awayScore }]
      .map(({ code, sc, other }) => {
        const t = cpblTeam(code)
        const lead = hasScore && (sc ?? 0) > (other ?? 0)
        const dim = hasScore && (sc ?? 0) < (other ?? 0)
        return (
          <div key={code} className={`lv-team${lead ? ' lead' : ''}${dim ? ' trail' : ''}`}>
            <span className="chip" style={{ background: t.bg, color: t.fg }}>{t.short}</span>
            <span className="nm">{t.name}</span>
            <span className="sc">{hasScore ? sc : ''}</span>
          </div>
        )
      })
  }

  const gameHead = (g: LiveGame) => {
    const st = gameState(g, data.lines)
    return (
      <div className="lv-ghead">
        {g.postseason && <div className="lv-kind">{KIND_NAME[g.kindCode] ?? '季後賽'}・不計入 fantasy</div>}
        <div className="teams">{scoreRows(g)}</div>
        <div className={`state${st.live ? ' live' : ''}`}>
          <span className="inn">{st.live && <i />}{st.inn}</span>
          <span className="sub">{st.sub}</span>
        </div>
      </div>
    )
  }

  /** 全場分頁的賽況：逐局比分、本半局、目前打者的打席結果、來源連結 */
  const detail = (g: LiveGame) => {
    if (mode !== 'full') return null
    const ls = g.lineScore
    const batter = g.batterId != null ? data.lines.find((l) => l.gameId === g.id && l.playerId === g.batterId) : null
    const half = g.halfInning && g.halfInning.length > 0
    if (!ls && !half && !(batter && g.batterResults?.length) && !g.sourceUrl) return null
    return (
      <div className="lv-detail">
        {ls && (
          <div className="lv-ls" role="table" aria-label="逐局比分">
            <div className="r h"><span />{ls.away.map((_, i) => <span key={i}>{i + 1}</span>)}<span>R</span><span>H</span><span>E</span></div>
            {[{ code: g.awayTeam, runs: ls.away, rhe: ls.awayRhe }, { code: g.homeTeam, runs: ls.home, rhe: ls.homeRhe }].map((x) => (
              <div key={x.code} className="r">
                <span className="t">{cpblTeam(x.code).short}</span>
                {x.runs.map((v, i) => <span key={i}>{v ?? ''}</span>)}
                {x.rhe.map((v, i) => <span key={`t${i}`} className="tot">{v ?? ''}</span>)}
              </div>
            ))}
          </div>
        )}
        {g.halfInning && g.halfInning.length > 0 && (
          <div className="lv-half">
            <span className="lab" title={OUTS_HINT}>本半局・{outsOf(g)} 出局</span>
            {g.halfInning.map((pa, i) => (
              <span key={i} className={pa.result == null ? 'now' : ''}>
                {i > 0 && <em>→</em>}{pa.name} {pa.result ?? '對決中'}
              </span>
            ))}
          </div>
        )}
        {batter && g.batterResults && g.batterResults.length > 0 && (
          <div className="lv-half"><span className="lab">{batter.name} 本場</span>{g.batterResults.join('・')}</div>
        )}
        {g.sourceUrl && <a className="lv-src" href={g.sourceUrl} target="_blank" rel="noopener noreferrer">到進階數據網站看這場 ↗</a>}
      </div>
    )
  }

  const nameCell = (r: Row, g: LiveGame) => (
    <>
      {r.sub && <span className="subm" aria-hidden>↳</span>}
      <Link to={`/players/${r.playerId}`} className="n">{r.name}</Link>
      {r.sub && <span className="tag">替補</span>}
      {mode !== 'mine' && r.team && <span className="ft" title={r.team.name} style={{ color: fantasyTeamColor(r.team.id, teams) }}><TeamIcon icon={r.team.icon} size={13} /></span>}
      {r.pos && r.pos !== r.slot && <span className="pos">{r.pos}</span>}
      {r.batting && <span className="tag live">打擊中</span>}
      {r.pitching && <span className="tag live">投球中{g.pitchCount != null ? `・${g.pitchCount} 球` : ''}</span>}
      {r.fresh && <span className="tag gold">剛更新</span>}
      {!r.line && <span className="tag">尚未上場</span>}
    </>
  )

  /** 手機：卡片下方的球員列 */
  const phoneRows = (g: LiveGame) => {
    const sides = sidesOf(g)
    return (
      <>
        {sides.map((sd) => {
          const t = cpblTeam(sd.code)
          const rows = [...sd.bats, ...sd.pits]
          return (
            <Fragment key={sd.code}>
              <div className="lv-side"><i style={{ background: t.bg }} /><b>{t.name}</b><span>{sd.label}</span><span className="sp" /><span>{rows.length} 人</span></div>
              {rows.map((r) => (
                <div key={r.key} className={`lv-row${r.fresh ? ' fresh' : ''}${r.sub ? ' sub' : ''}${r.team && r.team.id === data.myTeamId && mode !== 'mine' ? ' me' : ''}`}
                  style={r.team && r.team.id === data.myTeamId && mode !== 'mine' ? { boxShadow: `inset 2px 0 0 ${fantasyTeamColor(r.team.id, teams)}` } : undefined}>
                  <span className="slot">{r.slot}</span>
                  <div className="who">{nameCell(r, g)}</div>
                  <div className="tok">{r.line ? tokens(r.line).map((k, i) => <span key={i} className={k.c}>{k.t}</span>) : null}</div>
                </div>
              ))}
            </Fragment>
          )
        })}
        {sides.length === 0 && <div className="lv-empty">{emptyText}</div>}
      </>
    )
  }

  /** 網頁：右欄選中比賽的兩隊表格 */
  const wideTables = (g: LiveGame) => {
    const sides = sidesOf(g)
    return (
      <>
        {sides.map((sd) => {
          const t = cpblTeam(sd.code)
          return (
            <Fragment key={sd.code}>
              <div className="lv-wside"><span className="chip" style={{ background: t.bg, color: t.fg }}>{t.short}</span><b>{t.name}</b><span>{sd.label}</span><span className="sp" /><span>{sd.bats.length + sd.pits.length} 人</span></div>
              {[{ t: '打者', heads: BAT_HEADS, rows: sd.bats }, { t: '投手', heads: PIT_HEADS, rows: sd.pits }].filter((s) => s.rows.length > 0).map((sec) => (
                <Fragment key={sec.t}>
                  <div className="lv-grid head"><span>{mode === 'full' ? '棒次' : '名單'}</span><span>{sec.t}</span><span>幻想隊伍</span><span>位置</span>{sec.heads.map((h) => <span key={h} className="r">{h}</span>)}</div>
                  {sec.rows.map((r) => (
                    <div key={r.key} className={`lv-grid${r.fresh ? ' fresh' : ''}${r.sub ? ' sub' : ''}`}
                      style={r.team && r.team.id === data.myTeamId && mode !== 'mine' ? { boxShadow: `inset 2px 0 0 ${fantasyTeamColor(r.team.id, teams)}` } : undefined}>
                      <span className="slot">{r.slot}</span>
                      <div className="who">{nameCell(r, g)}</div>
                      <span className="ftn">{r.team ? <><span style={{ color: fantasyTeamColor(r.team.id, teams) }}><TeamIcon icon={r.team.icon} size={15} /></span>{r.team.name}</> : <span className="dim">—</span>}</span>
                      <span className="pos">{r.pos}</span>
                      {cells(r).map((c, i) => <span key={i} className={`r ${c.c ?? ''}`}>{c.v}</span>)}
                    </div>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          )
        })}
        {sides.length === 0 && <div className="lv-empty">{emptyText}</div>}
      </>
    )
  }

  const noGameBlock = noGame.length > 0 && (
    <>
      <div className="lv-label"><span>今日無比賽 · {noGame.length} 人</span><span className="muted">{offTeams.map((c) => cpblTeam(c).short).join('、')} 休兵</span></div>
      <div className="lv-off">
        {noGame.map((s) => {
          const t = teamOf(s.fantasyTeamId)
          return (
            <div key={s.playerId} className="lv-row off" style={t && t.id === data.myTeamId && mode !== 'mine' ? { boxShadow: `inset 2px 0 0 ${fantasyTeamColor(t.id, teams)}` } : undefined}>
              <span className="slot">{s.rosterSlot}</span>
              <div className="who"><Link to={`/players/${s.playerId}`} className="n">{s.name}</Link>
                {mode !== 'mine' && t && <span className="ft" style={{ color: fantasyTeamColor(t.id, teams) }}><TeamIcon icon={t.icon} size={13} /></span>}</div>
              <span className="team"><i style={{ background: cpblTeam(s.cpblTeam).bg }} />{cpblTeam(s.cpblTeam).short}</span>
            </div>
          )
        })}
      </div>
    </>
  )

  const header = (
    <div className="lv-head">
      <div className="t">
        <div className="lv-kicker"><i />LIVE · 非最終數據</div>
        <h1>即時比分</h1>
        <div className="upd">上次更新 {upd}・每 60 秒自動更新</div>
      </div>
      <button type="button" className="lv-ring" style={{ background: ring }} title="立即更新" aria-label={`${sec} 秒後更新，點一下立即更新`} onClick={load}>
        <span><b>{sec}</b><small>秒</small></span>
      </button>
    </div>
  )

  /** 網頁右欄的大比分：客隊「隊名 … 分數」、主隊「分數 … 隊名」 */
  const bigSide = (code: string, sc: number | null, other: number | null, label: string, home: boolean) => {
    const t = cpblTeam(code)
    const lead = sc != null && other != null && sc > other
    const team = <><span className="chip" style={{ background: t.bg, color: t.fg }}>{t.short}</span><b className={lead ? 'lead' : ''}>{t.name}</b><span className="muted">{label}</span></>
    const score = <span className={`sc${lead ? ' lead' : ''}`}>{sc ?? ''}</span>
    return <div className={`side${home ? ' h' : ''}`}>{home ? <>{score}<span className="sp" />{team}</> : <>{team}<span className="sp" />{score}</>}</div>
  }

  const footer = <p className="lv-note">{data.notice}{mode === 'full' ? '全場列出這場所有上場球員。' : '只列先發（BN、NA 不算）。'}</p>

  if (!wide) {
    return (
      <div className="lv">
        {header}
        {summary}
        <div className="lv-label"><span>今日賽事 · {data.games.length} 場</span>{seg}</div>
        {data.games.length === 0 && <div className="lv-empty box">今日無比賽（中職通常週一休兵，可自由調整名單）</div>}
        {data.games.map((g) => (
          <div key={g.id} className={`lv-card${PLAYING(g) ? '' : ' dimmed'}`}>
            {gameHead(g)}
            {detail(g)}
            {PLAYING(g) ? phoneRows(g) : null}
          </div>
        ))}
        {noGameBlock}
        {footer}
      </div>
    )
  }

  return (
    <div className="lv wide">
      <div className="lv-whead">
        {header}
        <span className="date">{data.today.slice(5).replace('-', '/')}・{league?.league.name}</span>
      </div>
      <div className="lv-cols">
        <div className="lv-left">
          {summary}
          <div className="lv-label"><span>今日賽事 · {data.games.length} 場</span><span className="muted">客 / 主</span></div>
          {data.games.length === 0 && <div className="lv-empty box">今日無比賽（中職通常週一休兵，可自由調整名單）</div>}
          {data.games.map((g) => (
            <button key={g.id} type="button" className={`lv-card pick${sel?.id === g.id ? ' sel' : ''}${PLAYING(g) ? '' : ' dimmed'}`} onClick={() => setSelId(g.id)}>
              {gameHead(g)}
              <div className="cnt">我的隊 {countIn(g, data.myTeamId)} 人・對手 {countIn(g, data.opponentTeamId)} 人</div>
            </button>
          ))}
          {noGameBlock}
        </div>
        <div className="lv-panel">
          <div className="lv-ptop"><span className="lv-label-t">本場即時數據</span><span className="lv-badge">非最終數據</span><span className="sp" />{seg}</div>
          {sel ? (
            <>
              <div className="lv-big">
                {bigSide(sel.awayTeam, sel.awayScore, sel.homeScore, '客', false)}
                {(() => {
                  const st = gameState(sel, data.lines)
                  return <div className={`mid${st.live ? ' live' : ''}`}><span className="inn">{st.live && <i />}{st.inn}</span><span className="sub">{st.sub}</span></div>
                })()}
                {bigSide(sel.homeTeam, sel.homeScore, sel.awayScore, '主', true)}
              </div>
              {detail(sel)}
              <div className="lv-scroll">{PLAYING(sel) ? wideTables(sel) : <div className="lv-empty">{gameState(sel, data.lines).sub}</div>}</div>
            </>
          ) : <div className="lv-empty">今天沒有比賽，沒有即時數據。</div>}
          <div className="lv-pfoot">{footer}</div>
        </div>
      </div>
    </div>
  )
}

