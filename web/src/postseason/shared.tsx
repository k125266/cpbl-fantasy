import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LiveGame, LiveLine, PostseasonView, SeriesView, TeamView } from '../api'
import { TeamIcon } from '../teamIdentity'
import { cpblTeam, fantasyTeamColor } from '../teams'
import { byOrder, winnerOf } from '../postseason'

/** 季後賽專區（設計稿「台灣大賽專區 v2」）各區塊共用的資料與小元件 */

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** "2026-10-17" → "10/17 週六" */
export function mdw(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d} 週${WEEK[new Date(y, m - 1, d).getDay()]}`
}

/** "2026-10-17" → "10/17" */
export function md(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

/** 開賽時間：24 小時制（"18:35"），小格子裡不會換行 */
export function hm(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })
}

export const SERVED = (g: LiveGame) => g.status !== 'POSTPONED' && g.status !== 'CANCELLED'

/** 一個系列戰在畫面上要用到的資料（從 API 的 SeriesView 推導一次，各區塊共用） */
export interface PsCtx {
  data: PostseasonView
  s: SeriesView
  teams: TeamView[]
  myTeam: TeamView | null
  /** 兩隊代碼，依第一場的客隊、主隊排列 */
  tA: string
  tB: string
  /** 依開賽順序 */
  games: LiveGame[]
  isFinals: boolean
  year: string
  decided: boolean
  /** 今天的比賽（進行中優先）；今天沒有比賽為 null */
  todayGame: LiveGame | null
  live: boolean
  /** 今天這場是第幾戰 */
  todayNo: number | null
  /** 下一場還沒打的比賽（不含今天這場） */
  nextGame: LiveGame | null
  lastFinal: LiveGame | null
  finished: LiveGame[]
  /** 第幾戰（從 1 開始） */
  noOf: (g: LiveGame) => number
}

export function buildCtx(data: PostseasonView, s: SeriesView, teams: TeamView[]): PsCtx {
  const games = [...s.games].sort(byOrder)
  const todayGames = games.filter((g) => g.playDate === data.today && SERVED(g))
  const todayGame = todayGames.find((g) => g.status === 'IN_PROGRESS') ?? todayGames[todayGames.length - 1] ?? null
  const finished = games.filter((g) => g.status === 'FINAL')
  return {
    data, s, teams, games, todayGame, finished,
    myTeam: teams.find((t) => t.id === data.myTeamId) ?? null,
    tA: s.teams[0], tB: s.teams[1],
    isFinals: s.kind === 'C',
    year: data.today.slice(0, 4),
    decided: s.winner != null,
    live: todayGame?.status === 'IN_PROGRESS',
    todayNo: todayGame ? games.indexOf(todayGame) + 1 : null,
    nextGame: games.find((g) => g.status === 'SCHEDULED' && g !== todayGame) ?? null,
    lastFinal: [...games].reverse().find((g) => g.status === 'FINAL') ?? null,
    noOf: (g) => games.indexOf(g) + 1,
  }
}

export const team = (code: string) => cpblTeam(code)

/** 球隊色塊（簡稱） */
export function Chip({ code, className }: { code: string; className?: string }) {
  const t = cpblTeam(code)
  return <span className={`pv-chip${className ? ` ${className}` : ''}`} style={{ background: t.bg, color: t.fg }}>{t.short}</span>
}

/** 球員背號色塊（球隊色） */
export function Num({ code, jersey, className }: { code: string; jersey: string | null; className?: string }) {
  const t = cpblTeam(code)
  return <span className={`pv-num${className ? ` ${className}` : ''}`} style={{ background: t.bg, color: t.fg }}>{jersey ?? ''}</span>
}

/** 「你的球員」標記（自己的 fantasy 隊伍圖示） */
export function Mine({ ctx, fantasyTeamId, size = 13 }: { ctx: PsCtx; fantasyTeamId: number | null; size?: number }) {
  if (fantasyTeamId == null || fantasyTeamId !== ctx.data.myTeamId || !ctx.myTeam) return null
  return <span className="pv-mine" title="你的球員" style={{ color: fantasyTeamColor(ctx.myTeam.id, ctx.teams) }}><TeamIcon icon={ctx.myTeam.icon} size={size} /></span>
}

/** 一個區塊：手機版標題在卡片外、網頁版標題在卡片裡（見 styles.css 的 .pv-sec） */
export function Section({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pv-sec${className ? ` ${className}` : ''}`}>
      <div className="pv-sh"><span>{title}</span>{note != null && <em>{note}</em>}</div>
      <div className="pv-card">{children}</div>
    </section>
  )
}

/** 勝隊與比分的一行說明，例如「兄弟獲勝」 */
export function resultText(g: LiveGame): string {
  const w = winnerOf(g)
  return w ? `${cpblTeam(w).short}獲勝` : '平手'
}

// ---------------------------------------------------------------------------
// 逐局比分
// ---------------------------------------------------------------------------

/** 進行中的半局：官網的局數文字「五上」「七下」「十一下」→ { i: 4, top: true }；解析不了就不標 */
export function curHalf(g: LiveGame): { i: number; top: boolean } | null {
  if (g.status !== 'IN_PROGRESS' || !g.inning) return null
  const m = /^([一二三四五六七八九十]+)(上|下)/.exec(g.inning)
  if (!m) return null
  const d = '一二三四五六七八九'
  const t = m[1]
  const n = t === '十' ? 10 : t.startsWith('十') ? 10 + d.indexOf(t[1]) + 1 : t.endsWith('十') ? (d.indexOf(t[0]) + 1) * 10 : d.indexOf(t) + 1
  return n > 0 ? { i: n - 1, top: m[2] === '上' } : null
}

/** 逐局比分表（兩隊色塊簡稱、每局得分、R、H）；進行中的半局標紅。沒有逐局資料時不顯示。 */
export function LineScore({ g, size = 'md' }: { g: LiveGame; size?: 'md' | 'sm' }) {
  const ls = g.lineScore
  if (!ls) return null
  const cur = curHalf(g)
  const n = Math.max(9, ls.away.length, ls.home.length)
  const rows = [
    { code: g.awayTeam, runs: ls.away, rhe: ls.awayRhe, top: true, other: ls.homeRhe },
    { code: g.homeTeam, runs: ls.home, rhe: ls.homeRhe, top: false, other: ls.awayRhe },
  ]
  return (
    <div className={`pv-ls ${size}`} style={{ '--n': n } as CSSProperties} role="table" aria-label="逐局比分">
      <div className="r h">
        <span />
        {Array.from({ length: n }, (_, i) => <span key={i} className={cur && cur.i === i ? 'cur' : ''}>{i + 1}</span>)}
        <span>R</span><span>H</span>
      </div>
      {rows.map((x) => {
        const R = x.rhe[0], oR = x.other[0]
        return (
          <div key={x.code} className="r b">
            <span className="tc"><Chip code={x.code} className="sm" /></span>
            {Array.from({ length: n }, (_, i) => {
              const v = x.runs[i]
              const on = !!cur && cur.top === x.top && cur.i === i
              return <span key={i} className={`v${on ? ' cur' : ''}${v == null || v === 0 ? ' z' : ''}`}>{v ?? ''}</span>
            })}
            <span className={`R${R != null && oR != null && R < oR ? ' lose' : ''}`}>{R ?? ''}</span>
            <span className="H">{x.rhe[1] ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 球員一行
// ---------------------------------------------------------------------------

/** 一位球員一行：標籤（打擊中／投球中／最佳打者…）、背號、名字、一句數據 */
export function Person({ ctx, label, l, text, tone, deskOnly }: { ctx: PsCtx; label: string; l: LiveLine; text: string; tone: 'live' | 'best'; deskOnly?: boolean }) {
  return (
    <div className={`pv-person ${tone}${deskOnly ? ' d-only' : ''}`}>
      <span className="lab">{label}</span>
      <Num code={l.cpblTeam} jersey={l.jerseyNumber} />
      <div className="b">
        <div className="nm"><Link to={`/players/${l.playerId}`}>{l.name}</Link><Mine ctx={ctx} fantasyTeamId={l.fantasyTeamId} /><span className="ts">{team(l.cpblTeam).short}</span></div>
        <div className="tx">{text}</div>
      </div>
    </div>
  )
}
