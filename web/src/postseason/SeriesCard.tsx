import type { LiveGame } from '../api'
import { maxGames, winnerOf } from '../postseason'
import { Chip, hm, md, mdw, team, type PsCtx } from './shared'

/** 系列戰卡：兩隊色塊與勝場、七（五）戰結果列、一行狀態。手機版是 G1～G7 小格，網頁版是左比分、右戰績格。 */

interface Cell {
  key: string | number
  no: number
  flag: string
  /** 網頁版大字：比分或開賽時間 */
  main: string
  /** 手機版小字：比分或日期 */
  mini: string
  tag: string
  /** 手機小格下方色線、網頁格標籤前的色點 */
  dot: string
  cls: 'today' | 'live' | 'next' | ''
  dim: boolean
}

export default function SeriesCard({ ctx }: { ctx: PsCtx }) {
  const { s, games, tA, tB, decided, todayGame, nextGame, isFinals, year, live, todayNo, noOf } = ctx
  const wa = s.wins[tA] ?? 0, wb = s.wins[tB] ?? 0
  const slots = Math.max(maxGames(s), games.length)

  // 還沒打完的比賽裡，前 minRemaining 場一定會打（領先隊還差幾勝，至少還要打幾場），之後的是「若需要」
  const minRemaining = Math.max(Math.min(s.winsNeeded - wa, s.winsNeeded - wb), 0)
  let certain = minRemaining

  const cell = (i: number): Cell => {
    const g: LiveGame | undefined = games[i]
    const no = i + 1
    const base = { key: g ? g.id : `x${i}`, no, flag: '', cls: '' as Cell['cls'], dim: false, dot: 'transparent' }
    if (!g || (g.status !== 'FINAL' && g.status !== 'IN_PROGRESS')) {
      const needed = decided ? false : certain-- > 0
      const tag = g?.status === 'POSTPONED' ? '延賽' : decided ? '未舉行' : needed ? '' : '若需要'
      const isNext = !!g && g === nextGame && !todayGame
      return {
        ...base, flag: isNext ? '下一戰' : '', cls: isNext ? 'next' : '', dim: !g || !needed,
        main: g?.startTime ? hm(g.startTime) : '—', mini: g ? md(g.scheduledDate) : '—', tag,
      }
    }
    const isToday = g.playDate === ctx.data.today
    if (g.status === 'IN_PROGRESS') {
      const sc = (c: string) => (c === g.homeTeam ? g.homeScore : g.awayScore) ?? 0
      const a = sc(tA), b = sc(tB)
      certain--
      return {
        ...base, flag: '今天', cls: 'live', dot: '#ff4d4f', main: `${a}:${b}`, mini: `${a}:${b}`,
        tag: `${a === b ? '平手' : `${team(a > b ? tA : tB).short}領先`}・${g.inning ?? ''}`,
      }
    }
    const w = winnerOf(g)
    const hi = Math.max(g.homeScore ?? 0, g.awayScore ?? 0), lo = Math.min(g.homeScore ?? 0, g.awayScore ?? 0)
    return {
      ...base, flag: isToday ? '今天' : '', cls: isToday ? 'today' : '', dot: w ? team(w).bg : 'transparent',
      main: `${hi}:${lo}`, mini: `${hi}:${lo}`, tag: w ? `${team(w).short}勝` : '和局',
    }
  }
  const cells = Array.from({ length: slots }, (_, i) => cell(i))

  const when = (g: LiveGame) => `第 ${noOf(g)} 戰 ${mdw(g.scheduledDate)}${g.startTime ? ` ${hm(g.startTime)}` : ''}`
  const status = (() => {
    if (decided) {
      const w = s.winner as string, o = w === tA ? tB : tA
      return `${team(w).short}以 ${s.wins[w]}：${s.wins[o]} ${isFinals ? `奪得 ${year} 總冠軍` : '晉級台灣大賽'}`
    }
    if (live && todayNo) return `第 ${todayNo} 戰進行中`
    if (todayGame && todayGame.status === 'FINAL' && todayNo) {
      const w = winnerOf(todayGame)
      return `第 ${todayNo} 戰 ${w ? `${team(w).short}獲勝` : '平手'}。` + (nextGame ? `下一戰 ${when(nextGame)}` : '')
    }
    if (nextGame) return `今天休息。${when(nextGame)} 開打`
    return '還沒有排定的比賽'
  })()

  const lead = decided
    ? `${team(s.winner as string).short}${isFinals ? '奪冠' : '晉級'}`
    : wa === wb ? '系列戰平手' : `${team(wa > wb ? tA : tB).short}領先`
  const note = s.advantageTeam ? `（${team(s.advantageTeam).short}保送 1 勝）` : ''

  return (
    <div className="pv-card pv-series">
      <div className="pv-sleft">
        <div className="pv-score">
          <Chip code={tA} className="lg" />
          <div className="big">
            <span className={wa >= wb ? '' : 'trail'}>{wa}</span><i>:</i><span className={wb >= wa ? '' : 'trail'}>{wb}</span>
          </div>
          <Chip code={tB} className="lg" />
        </div>
        <div className="pv-lead">{lead}・先拿 {s.winsNeeded} 勝{isFinals ? '奪冠' : '晉級'}{note}</div>
      </div>
      <div className="pv-sright">
        {/* 手機：G1～G7 小格 */}
        <div className="pv-mini" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {cells.map((c) => (
            <div key={c.key} className={`c ${c.cls}`}>
              <div className="g">G{c.no}</div>
              <div className={`m${c.dim ? ' dim' : ''}`}>{c.mini}</div>
              <div className="bar" style={{ background: c.dot }} />
            </div>
          ))}
        </div>
        {/* 網頁：每戰一格 */}
        <div className="pv-cells" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {cells.map((c) => (
            <div key={c.key} className={`c ${c.cls}`}>
              <div className="top"><span>第 {c.no} 戰</span><em>{c.flag}</em></div>
              <div className={`m${c.dim ? ' dim' : ''}`}>{c.main}</div>
              <div className="tag"><i style={{ background: c.dot }} />{c.tag}</div>
            </div>
          ))}
        </div>
        <div className="pv-status">{status}</div>
      </div>
    </div>
  )
}
