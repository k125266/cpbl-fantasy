import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type Matchup, type RosterPlayer, type RosterResponse, type SlotName, type StandingRow } from '../api'
import { BottomSheet, ErrorBox, fmtDate, fmtTime, Loading, MatchTicket, MiniCard, TeamChip, TIER_LABEL, TierAvatar, tierOf, toast, useLoad, weekday } from '../components'
import { fmtPts, myMatchups, periodDay, type MySide } from '../matchups'
import { cpblTeam, fantasyTeamColor } from '../teams'

interface Seat {
  slot: SlotName
  player: RosterPlayer | null
}

type View = 'list' | 'cards'
const VIEW_KEY = 'team-lineup-view'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'list'
  } catch {
    return 'list'
  }
}

function isPitcherRow(p: RosterPlayer) {
  return p.slot === 'SP' || p.slot === 'RP' || p.listedPosition === 'P'
}

interface PodCell {
  label: string
  val: string | number
  /** 數字顏色：hi 亮、dim 暗、gold 金；未給為灰（本季數據） */
  cls?: 'hi' | 'dim' | 'gold'
  warn?: boolean
}

/** 一位球員在名單上的呈現：今日數據格、卡冊摘要、比賽資訊、狀態旗。只寫客觀出賽狀態（規則書 6.1.3）。 */
function lineInfo(p: RosterPlayer) {
  const pit = isPitcherRow(p)
  const g = p.game
  const ts = p.today?.stats
  const minors = p.status.code === 'MINORS'
  const delisted = p.status.code === 'DELISTED'
  const idle = p.status.code === 'IDLE'
  const ppd = g?.status === 'POSTPONED'
  const live = g?.status === 'IN_PROGRESS' && !minors && !delisted
  const season: PodCell = pit ? { label: 'ERA', val: p.season.ERA ?? '—' } : { label: 'AVG', val: p.season.AVG ?? '—' }
  const n = (v: number, hi: PodCell['cls'] = 'hi'): PodCell['cls'] => (v ? hi : 'dim')

  let pod: PodCell[]
  let short = '—'
  if (minors || delisted) {
    pod = [{ label: minors ? '二軍' : '註銷', val: '—', cls: 'dim', warn: true }, season]
    short = minors ? '二軍' : '已註銷'
  } else if (ppd) {
    pod = [{ label: '延賽', val: '—', cls: 'dim', warn: true }, season]
    short = '延賽'
  } else if (pit) {
    if (ts?.pitched) {
      const ip = `${Math.floor(ts.outs / 3)}.${ts.outs % 3}`
      pod = [{ label: 'IP', val: ip, cls: 'hi' }, { label: 'ER', val: ts.er, cls: n(ts.er) }, { label: 'K', val: ts.k, cls: n(ts.k) }]
      short = `${ip}IP ${ts.k}K`
    } else {
      pod = [{ label: '今日', val: '—', cls: 'dim' }, season]
      short = g && g.status !== 'SCHEDULED' ? '未登板' : '—'
    }
  } else if (ts && !ts.pitched) {
    pod = [
      { label: 'H/AB', val: `${ts.h}-${ts.ab}`, cls: ts.h ? 'hi' : undefined },
      { label: 'HR', val: ts.hr, cls: n(ts.hr, 'gold') },
      ts.sb && !ts.rbi ? { label: 'SB', val: ts.sb, cls: 'hi' } : { label: 'RBI', val: ts.rbi, cls: n(ts.rbi) },
    ]
    short = `${ts.h}-${ts.ab}` + (ts.hr ? ' HR' : ts.rbi ? ` ${ts.rbi}RBI` : '')
  } else {
    pod = [season]
  }

  let meta: string
  if (minors) meta = `${p.listedPosition}・未在一軍名單`
  else if (delisted) meta = p.status.text
  else if (!g) meta = '今日無比賽'
  else {
    const opp = `${g.home ? 'vs' : '@'} ${cpblTeam(g.opponent).short}`
    const score = g.teamScore != null && g.oppScore != null ? ` ${g.teamScore}:${g.oppScore}` : ''
    switch (g.status) {
      case 'POSTPONED': meta = `${opp}・延賽`; break
      case 'IN_PROGRESS': meta = `${opp}${score}${g.inning ? `・${g.inning}` : ''}${pit && !ts?.pitched ? '・未登板' : ''}`; break
      case 'FINAL': meta = `${opp}${score}・終場`; break
      case 'SUSPENDED': meta = `${opp}${score}・保留比賽`; break
      default: meta = `${opp} ${fmtTime(g.startTime)}`
    }
  }

  const flag = minors ? { text: '二軍', bad: false } : idle ? { text: '未出賽', bad: true } : delisted ? { text: '已註銷', bad: true } : null
  const tone: 'warn' | 'muted' | undefined = minors || ppd || delisted ? 'warn' : short === '未登板' || short === '—' ? 'muted' : undefined
  return { pod, short, meta, live, flag, tone, tier: tierOf(p.rank) }
}

function pendText(p: RosterPlayer) {
  if (p.pendingFrom) return `${fmtDate(p.pendingFrom)} 起生效`
  if (p.leavingOn) return `${fmtDate(p.leavingOn)} 離隊`
  return null
}

export default function TeamPage() {
  const { teamId } = useParams()
  const { leagueId, league, reloadLeague } = useApp()
  const navigate = useNavigate()
  const id = teamId ? Number(teamId) : league?.myTeamId
  const mine = id === league?.myTeamId
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${id}/roster`), [leagueId, id])
  const matchups = useLoad(() => api.get<Matchup[]>(`/api/leagues/${leagueId}/matchups`), [leagueId])
  const standings = useLoad(() => api.get<{ half1: StandingRow[]; half2: StandingRow[] }>(`/api/leagues/${leagueId}/standings`), [leagueId])
  const [sheet, setSheet] = useState<RosterPlayer | null>(null)

  if (!id) return <p className="muted">找不到隊伍</p>
  if (roster.loading && !roster.data) return <Loading />
  if (roster.error || !roster.data) return <ErrorBox error={roster.error} />
  const data = roster.data
  const team = league?.teams.find((t) => t.id === id)
  const halfNo = league?.currentPeriod?.halfNo ?? 1
  const halfRows = (halfNo === 2 ? standings.data?.half2 : standings.data?.half1) ?? []
  // 每期雙對手：本期有兩場
  const tickets = myMatchups(matchups.data ?? [], data.period?.id, id)

  const starters = data.players.filter((p) => !['BN', 'NA'].includes(p.slot))
  const problems = starters.filter((p) => p.status.code !== 'ACTIVE' || p.game?.status === 'POSTPONED')
  const reload = () => {
    roster.reload()
    reloadLeague()
  }

  return (
    <div className="stack" style={{ paddingTop: 0 }}>
      <TeamHero teamId={id} name={data.teamName} abbr={team?.abbr ?? ''} owner={team?.owner ?? ''} mine={mine} halfNo={halfNo}
        rows={halfRows} tickets={tickets} today={data.today} teamIds={(league?.teams ?? []).map((t) => t.id)} />

      <div className="pills">
        <span className="pill">{fmtDate(data.today)} 週{weekday(data.today)}</span>
        <span className="pill">FAAB {data.faabBudget}</span>
        <span className="pill">{data.players.filter((p) => p.slot !== 'NA').length}/{data.rosterSize} 人・洋將 {data.players.filter((p) => p.foreign).length}/{data.foreignLimit}</span>
        {!mine && <button type="button" className="pill gold" onClick={() => navigate('/')}>回我的隊伍</button>}
      </div>

      {data.lineupLockReason && <div className="alert error">名單鎖定中：{data.lineupLockReason}</div>}

      {mine && problems.length > 0 && <TodayNotice problems={problems} onOpen={setSheet} />}

      <div>
        <Lineup data={data} onOpen={setSheet} onEmpty={mine ? () => navigate('/players') : undefined} />
      </div>

      {sheet && (
        <MoveSheet player={sheet} data={data} mine={mine} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload() }} />
      )}
    </div>
  )
}

/** 隊伍頭部：名次與戰績、撕線下方本期兩張小票根與進度。 */
function TeamHero({ teamId, name, abbr, owner, mine, halfNo, rows, tickets, today, teamIds }: {
  teamId: number
  name: string
  abbr: string
  owner: string
  mine: boolean
  halfNo: number
  rows: StandingRow[]
  tickets: MySide[]
  today: string
  teamIds: number[]
}) {
  const st = rows.find((r) => r.teamId === teamId)
  const half = halfNo === 2 ? '下' : '上'
  // 與第 1 名（或第 2 名）的場差：((勝差) + (敗差)) / 2
  const gap = (a: StandingRow, b: StandingRow) => ((a.wins - b.wins) + (b.losses - a.losses)) / 2
  let gbText = ''
  if (st) {
    const other = rows.find((r) => r.rank === (st.rank === 1 ? 2 : 1))
    const g = other ? (st.rank === 1 ? gap(st, other) : gap(other, st)) : 0
    gbText = g === 0 ? (other ? '並列第 1' : '') : st.rank === 1 ? `領先 ${fmtPts(g)} 場` : `落後 ${fmtPts(g)} 場`
  }
  const m0 = tickets[0]?.m
  const allFinal = tickets.length > 0 && tickets.every((t) => t.final)
  const allPending = tickets.every((t) => t.m.status === 'PENDING')
  const live = tickets.some((t) => t.live)
  const w = tickets.filter((t) => t.result === 'W').length
  const l = tickets.filter((t) => t.result === 'L').length
  const t = tickets.length - w - l
  const { day, len } = m0 ? periodDay(m0.start, m0.end, today) : { day: 0, len: 1 }

  return (
    <div className="thero">
      <div className="wm" aria-hidden="true">{abbr}</div>
      <div className="th-top">
        <div style={{ minWidth: 0 }}>
          <div className="kick-en">{mine ? 'MY TEAM' : 'TEAM'} · H{halfNo}{st ? ` RANK ${st.rank}` : ''}</div>
          <div className="th-name">{name}</div>
          <div className="th-sub">{owner}{st && `・${half}半季第 ${st.rank} 名`}{gbText && `・${gbText}`}</div>
        </div>
        <div className="th-rec">
          <small>H{halfNo} · W – L – T</small>
          <b>{st?.wins ?? 0}<i>-</i>{st?.losses ?? 0}<i>-</i>{st?.ties ?? 0}</b>
        </div>
      </div>

      <div className="th-cut">
        {m0 ? (
          <>
            <div className="mh-top">
              <span><b className="c-w" style={{ fontWeight: 500 }}>TICKETS</b> · {m0.kind === 'FINAL' ? 'FINAL' : `PERIOD ${m0.periodNo}`} · {fmtDate(m0.start)}–{fmtDate(m0.end)}</span>
              {!allPending && <span className={`livepill ${live ? 'live' : ''}`}>{live ? 'LIVE' : 'FINAL'}</span>}
            </div>
            <div className={`th-tix ${tickets.length === 1 ? 'one' : ''}`}>
              {tickets.map((v, i) => <MatchTicket key={v.m.id} v={v} no={i + 1} size="sm" color={fantasyTeamColor(v.oppId, teamIds)} />)}
            </div>
            <div className="mh-tot">
              <span>{allPending ? '本期尚未開始' : `本期 ${w} 勝 ${l} 敗${t ? ` ${t} 和` : ''}`} · 類別合計 <b>{fmtPts(tickets.reduce((a, x) => a + x.me, 0))}</b> : {fmtPts(tickets.reduce((a, x) => a + x.op, 0))}</span>
              <span>{allPending ? `${fmtDate(m0.start)} 開始` : `DAY ${allFinal ? len : day} / ${len}`}</span>
            </div>
            <div className="dayline"><i style={{ width: `${allFinal ? 100 : allPending ? 0 : (day / len) * 100}%` }} /></div>
          </>
        ) : <p className="muted small" style={{ margin: 0 }}>目前不在對戰期間（開季前或例行賽結束）。</p>}
      </div>
    </div>
  )
}

function TodayNotice({ problems, onOpen }: { problems: RosterPlayer[]; onOpen: (p: RosterPlayer) => void }) {
  const [all, setAll] = useState(false)
  const status = problems.filter((p) => p.status.code !== 'ACTIVE')
  const postponed = problems.filter((p) => p.status.code === 'ACTIVE')
  const shown = all ? status : status.slice(0, 3)
  return (
    <div className="notice">
      <div className="notice-title">今天要注意</div>
      {shown.map((p) => (
        <div className="nrow" key={p.playerId}>
          <span className="d" style={{ background: 'var(--bad)' }} />
          <span><b>{p.name}</b> 在 {p.slot} 先發，{p.status.text}</span>
          <button type="button" className="small" onClick={() => onOpen(p)}>換人</button>
        </div>
      ))}
      {status.length > 3 && !all && <button type="button" className="small" style={{ justifySelf: 'start' }} onClick={() => setAll(true)}>還有 {status.length - 3} 位</button>}
      {postponed.length > 0 && (
        <div className="nrow">
          <span className="d" style={{ background: 'var(--warn)' }} />
          <span>{postponed.length} 名先發所屬球隊今日延賽：{postponed.map((p) => p.name).join('、')}</span>
          <span />
        </div>
      )}
    </div>
  )
}

/** 名單：LINEUP 標題與列表／卡冊切換、01 打者、02 投手、03 後備。 */
function Lineup({ data, onOpen, onEmpty }: { data: RosterResponse; onOpen: (p: RosterPlayer) => void; onEmpty?: () => void }) {
  const [view, setView] = useState<View>(loadView)
  const choose = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 無法儲存時只影響這次瀏覽
    }
  }
  const seats = (slots: SlotName[]): Seat[] => {
    const out: Seat[] = []
    for (const s of slots) {
      const ps = data.players.filter((p) => p.slot === s)
      ps.forEach((p) => out.push({ slot: s, player: p }))
      for (let i = ps.length; i < (data.slotCounts[s] ?? 0); i++) out.push({ slot: s, player: null })
    }
    return out
  }
  const count = (ss: Seat[]) => `${ss.filter((s) => s.player).length}/${ss.length}`
  const sections: [string, string, string, Seat[]][] = [
    ['01', '打者', 'BATTERS', seats(['IF', 'OF', 'UTIL'])],
    ['02', '投手', 'PITCHERS', seats(['SP', 'RP'])],
  ]
  const bench = seats(['BN', 'NA'])

  return (
    <>
      <div className="lineup-head">
        <span>LINEUP · {data.players.length} CARDS</span>
        <div className="vtoggle" role="group" aria-label="名單呈現方式">
          <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>列表</button>
          <button type="button" aria-pressed={view === 'cards'} onClick={() => choose('cards')}>卡冊</button>
        </div>
      </div>
      {sections.map(([no, title, en, ss]) => (
        <div key={no}>
          <div className="sec lineup"><span className="no">{no}</span><span className="t">{title}</span><span className="en">{en}</span><span className="r">{count(ss)}</span></div>
          {view === 'list' ? (
            <div className="lrows">{ss.map((s, i) => <LineRow key={s.player?.playerId ?? `${s.slot}${i}`} seat={s} onOpen={onOpen} onEmpty={onEmpty} />)}</div>
          ) : (
            <div className="cards3">{ss.map((s, i) => <LineCard key={s.player?.playerId ?? `${s.slot}${i}`} seat={s} onOpen={onOpen} onEmpty={onEmpty} />)}</div>
          )}
        </div>
      ))}
      <div className="sec dim lineup" style={{ marginTop: 34 }}>
        <span className="no">03</span><span className="t">後備</span><span className="en">BENCH · NA</span><span className="r">{count(bench)}</span>
      </div>
      <div className="bgrid">{bench.map((s, i) => <BenchCell key={s.player?.playerId ?? `${s.slot}${i}`} seat={s} onOpen={onOpen} />)}</div>
    </>
  )
}

function LineRow({ seat, onOpen, onEmpty }: { seat: Seat; onOpen: (p: RosterPlayer) => void; onEmpty?: () => void }) {
  const p = seat.player
  if (!p) {
    return (
      <button type="button" className="lrow empty" onClick={onEmpty} disabled={!onEmpty}>
        <div className="slotc">{seat.slot}</div>
        <div className="ring0" />
        <div className="hint">空位・簽入自由球員</div>
        <div />
      </button>
    )
  }
  const x = lineInfo(p)
  const pend = pendText(p)
  return (
    <button type="button" className={`lrow ${x.tier === 'gold' ? 'gold' : ''}`} onClick={() => onOpen(p)}>
      <div className="slotc">{seat.slot}</div>
      <TierAvatar team={p.cpblTeam} number={p.jerseyNumber} tier={x.tier} />
      <div style={{ minWidth: 0 }}>
        <div className="nm">
          <b>{p.name}</b><TeamChip code={p.cpblTeam} />
          {x.flag && <span className={`flag ${x.flag.bad ? 'bad' : ''}`}>{x.flag.text}</span>}
        </div>
        <div className="meta">{x.live && <span className="ldot" />}<span>{x.meta}</span></div>
        {pend && <div className="pend">{pend}</div>}
      </div>
      <div className="pod">
        {x.pod.map((c) => (
          <div key={c.label}><small className={c.warn ? 'warn' : ''}>{c.label}</small><b className={c.cls ?? ''}>{c.val}</b></div>
        ))}
      </div>
    </button>
  )
}

function LineCard({ seat, onOpen, onEmpty }: { seat: Seat; onOpen: (p: RosterPlayer) => void; onEmpty?: () => void }) {
  const p = seat.player
  if (!p) {
    return <button type="button" className="cempty" onClick={onEmpty} disabled={!onEmpty}><b>{seat.slot}</b><small>空位</small></button>
  }
  const x = lineInfo(p)
  return (
    <MiniCard name={p.name} team={p.cpblTeam} number={p.jerseyNumber} slot={seat.slot} tier={x.tier} line={x.short}
      live={x.live} tone={x.tone} dot={x.flag ? (x.flag.bad ? 'var(--bad)' : 'var(--warn)') : undefined} onOpen={() => onOpen(p)} />
  )
}

function BenchCell({ seat, onOpen }: { seat: Seat; onOpen: (p: RosterPlayer) => void }) {
  const p = seat.player
  if (!p) {
    return (
      <div className="bcell" style={{ cursor: 'default' }}>
        <div className="ring0 sm" /><div className="bs" style={{ fontSize: 12 }}>{seat.slot} 空位</div>
      </div>
    )
  }
  const x = lineInfo(p)
  return (
    <button type="button" className="bcell" onClick={() => onOpen(p)}>
      <TierAvatar team={p.cpblTeam} number={p.jerseyNumber} tier={x.tier} size="sm" />
      <div>
        <div className="bn">{p.name}{x.flag && <span className="fd" style={{ background: x.flag.bad ? 'var(--bad)' : 'var(--warn)' }} />}</div>
        <div className="bs">{seat.slot} · {pendText(p) ?? x.short}</div>
      </div>
    </button>
  )
}

/** 該球員能否移入某個位置。 */
function canPlay(p: RosterPlayer, slot: SlotName) {
  if (slot === 'BN') return true
  if (slot === 'NA') return p.status.code === 'MINORS'
  return p.eligible.includes(slot)
}

const SLOT_OPTIONS: SlotName[] = ['IF', 'OF', 'UTIL', 'SP', 'RP', 'BN', 'NA']

const HIT_COLS = ['H/AB', 'R', 'HR', 'RBI', 'SB', 'AVG']
const PIT_COLS = ['IP', 'QS', 'K', 'SV+HLD', 'ERA', 'WHIP']

/** 選單頂部：等級頭像與排名、可守位置、今日數據格，以及本期／本季的類別數據（更多到球員資料頁看）。 */
function SheetHead({ player }: { player: RosterPlayer }) {
  const x = lineInfo(player)
  const cols = isPitcherRow(player) ? PIT_COLS : HIT_COLS
  const rows: [string, Record<string, string>][] = player.period ? [['本期', player.period], ['本季', player.season]] : [['本季', player.season]]
  const cell = (r: Record<string, string>, c: string) => (c === 'H/AB' ? `${r.H ?? 0}-${r.AB ?? 0}` : r[c] ?? '—')
  const elig = player.eligible.filter((s) => s !== 'BN' && s !== 'NA')
  return (
    <>
      <div className="shead">
        <TierAvatar team={player.cpblTeam} number={player.jerseyNumber} tier={x.tier} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="nm">
            <b>{player.name}</b><TeamChip code={player.cpblTeam} />
            {x.flag && <span className={`flag ${x.flag.bad ? 'bad' : ''}`}>{x.flag.text}</span>}
          </div>
          <div className={`rk ${x.tier}`}>{TIER_LABEL[x.tier]}{player.rank ? ` · 本季第 ${player.rank} 名` : ''}</div>
          <div className="el">目前 {player.slot}・可守 {elig.length ? elig.join(' / ') : '—'}</div>
        </div>
      </div>
      <div className="stoday">
        <div className="meta">{x.live && <span className="ldot" />}<span>今日・{x.meta}</span></div>
        <div className="pod">
          {x.pod.map((c) => (
            <div key={c.label}><small className={c.warn ? 'warn' : ''}>{c.label}</small><b className={c.cls ?? ''}>{c.val}</b></div>
          ))}
        </div>
      </div>
      <table className="stbl">
        <thead><tr><th />{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map(([label, r]) => (
            <tr key={label}><th>{label}</th>{cols.map((c) => <td key={c}>{cell(r, c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function MoveSheet({ player, data, mine, onClose, onDone }: {
  player: RosterPlayer
  data: RosterResponse
  mine: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { leagueId } = useApp()
  const navigate = useNavigate()
  const [target, setTarget] = useState<SlotName | null>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const allowed = (s: SlotName) => s !== player.slot && canPlay(player, s)

  const move = async (moves: { playerId: number; slot: SlotName }[]) => {
    setError(null)
    try {
      await api.put(`/api/leagues/${leagueId}/roster/slots`, { moves })
      toast(`${player.name} 已移到 ${moves[0].slot}`)
      onDone()
    } catch (e) {
      setError(e)
    }
  }

  const choose = (s: SlotName) => {
    const occupants = data.players.filter((p) => p.slot === s)
    if (occupants.length < (data.slotCounts[s] ?? 0)) {
      move([{ playerId: player.playerId, slot: s }])
    } else {
      setTarget(s)
    }
  }

  const drop = async () => {
    try {
      const r = await api.post<{ effectiveDate: string }>(`/api/leagues/${leagueId}/roster/drop`, { playerId: player.playerId })
      toast(`${player.name} 已釋出，${fmtDate(r.effectiveDate)} 生效`)
      onDone()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <BottomSheet onClose={onClose} label={`調整 ${player.name}`}>
      <SheetHead player={player} />
      <ErrorBox error={error} />
      {mine && !target && !confirmDrop && (
        player.locked ? (
          <p className="ps" style={{ margin: 0 }}>今日比賽已開打，位置已鎖定，明天才能調整。</p>
        ) : (
          <>
            <p className="ps" style={{ margin: 0 }}>目前在 {player.slot}，移到：</p>
            <div className="slot-opts">
              {SLOT_OPTIONS.filter((s) => s !== player.slot && (s !== 'NA' || player.status.code === 'MINORS')).map((s) => (
                <button key={s} type="button" disabled={!allowed(s)} onClick={() => choose(s)}>
                  {s}<small>{s === 'BN' ? '板凳' : s === 'NA' ? '二軍名額' : allowed(s) ? '可移入' : '無資格'}</small>
                </button>
              ))}
            </div>
          </>
        )
      )}
      {target && (
        <>
          <p className="ps" style={{ margin: 0 }}>{target} 已滿，選一位交換到 {player.slot}：</p>
          {data.players.filter((p) => p.slot === target).map((p) => {
            const fits = canPlay(p, player.slot)
            return (
              <button key={p.playerId} type="button" className="btn-block" disabled={p.locked || !fits}
                onClick={() => move([{ playerId: player.playerId, slot: target }, { playerId: p.playerId, slot: player.slot }])}>
                {p.name}{p.locked ? '（已鎖定）' : !fits ? `（無 ${player.slot} 資格）` : ''}
              </button>
            )
          })}
          <button type="button" className="btn-block" onClick={() => setTarget(null)}>返回</button>
        </>
      )}
      {confirmDrop ? (
        <>
          <p className="ps" style={{ margin: 0 }}>確定釋出 {player.name}？釋出後進入 waiver 期，其他隊伍可以出價。</p>
          <div className="row2">
            <button type="button" className="danger" onClick={drop}>確定釋出</button>
            <button type="button" onClick={() => setConfirmDrop(false)}>取消</button>
          </div>
        </>
      ) : !target && (
        <>
          <button type="button" className="primary btn-block" onClick={() => navigate(`/players/${player.playerId}`)}>查看球員資料</button>
          <div className="row2">
            {mine ? <button type="button" className="danger" onClick={() => setConfirmDrop(true)}>釋出</button> : <span />}
            <button type="button" onClick={onClose}>關閉</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
