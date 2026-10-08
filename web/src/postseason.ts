import type { LiveGame, LiveLine, SeriesView } from './api'
import { ip } from './live'

/** 季後賽專區的計算：系列戰累計、排行、最佳球員、戰績列（全是純函式，頁面只負責排版） */

/** 打者累計 */
export interface BatAgg {
  playerId: number
  name: string
  jersey: string | null
  team: string
  pos: string
  fantasyTeamId: number | null
  g: number; pa: number; ab: number; h: number; r: number; hr: number; bb: number
}

/** 投手累計 */
export interface PitAgg {
  playerId: number
  name: string
  jersey: string | null
  team: string
  pos: string
  fantasyTeamId: number | null
  g: number; outs: number; h: number; bb: number; er: number; k: number; w: number; sv: number
}

export const isBatLine = (l: LiveLine) => l.batted && l.pa > 0
export const isPitLine = (l: LiveLine) => l.pitched

export function aggregate(lines: LiveLine[]): { bats: BatAgg[]; pits: PitAgg[] } {
  const bats = new Map<number, BatAgg>()
  const pits = new Map<number, PitAgg>()
  for (const l of lines) {
    const who = { playerId: l.playerId, name: l.name, jersey: l.jerseyNumber, team: l.cpblTeam, pos: l.listedPosition, fantasyTeamId: l.fantasyTeamId }
    if (isBatLine(l)) {
      const a = bats.get(l.playerId) ?? { ...who, g: 0, pa: 0, ab: 0, h: 0, r: 0, hr: 0, bb: 0 }
      a.g++; a.pa += l.pa; a.ab += l.ab; a.h += l.h; a.r += l.r; a.hr += l.hr; a.bb += l.bb
      bats.set(l.playerId, a)
    }
    if (isPitLine(l)) {
      const a = pits.get(l.playerId) ?? { ...who, g: 0, outs: 0, h: 0, bb: 0, er: 0, k: 0, w: 0, sv: 0 }
      a.g++; a.outs += l.outs; a.h += l.pH; a.bb += l.pBb; a.er += l.pEr; a.k += l.pK; a.w += l.w; a.sv += l.sv
      pits.set(l.playerId, a)
    }
  }
  return { bats: [...bats.values()], pits: [...pits.values()] }
}

/** 打擊率：沒有打數顯示 –，滿 1 成顯示 1.000 */
export function avg(h: number, ab: number): string {
  if (!ab) return '–'
  const v = h / ab
  return v >= 1 ? '1.000' : '.' + String(Math.round(v * 1000)).padStart(3, '0')
}

/** 防禦率（9 局責失分）；沒有出局數時為 null */
export function eraNum(p: { er: number; outs: number }): number | null {
  return p.outs > 0 ? (p.er * 27) / p.outs : null
}
export const eraText = (p: { er: number; outs: number }) => {
  const e = eraNum(p)
  return e == null ? '–' : e.toFixed(2)
}

/** 整數局數：6.0 → "6"、6.1 → "6.1" */
export const ipShort = (outs: number) => (outs % 3 ? ip(outs) : String(outs / 3))

// ---- 最佳球員（設計稿公式）----

export const batScore = (l: LiveLine) => l.h * 2 + l.hr * 3 + l.r + l.bb * 0.5 - l.ab * 0.1
export const pitScore = (l: LiveLine) => l.outs / 3 + l.pK * 0.5 - l.pEr * 2 - (l.pH + l.pBb) * 0.3 + (l.w ? 1 : 0)

export function bestBatter(lines: LiveLine[]): LiveLine | null {
  const c = lines.filter(isBatLine)
  return c.length ? c.reduce((a, b) => (batScore(b) > batScore(a) ? b : a)) : null
}
export function bestPitcher(lines: LiveLine[]): LiveLine | null {
  const c = lines.filter(isPitLine)
  return c.length ? c.reduce((a, b) => (pitScore(b) > pitScore(a) ? b : a)) : null
}

export function batText(l: LiveLine): string {
  return `${l.ab} 打數 ${l.h} 安` + (l.hr ? ` ${l.hr} 轟` : '') + (l.r ? ` ${l.r} 得分` : '') + (l.bb ? ` ${l.bb} 保送` : '')
}
export function pitText(l: LiveLine): string {
  return `${ipShort(l.outs)} 局 ${l.pK} K` + (l.pEr ? ` 失 ${l.pEr} 分` : ' 無失分') + (l.w ? '・勝投' : l.sv ? '・救援成功' : '')
}

// ---- 排行 ----

export interface Board<T> {
  title: string
  key: string
  note: string
  emptyText: string
  rows: { rank: number; who: T; value: string; sub: string }[]
}

/** 前三名；同數值同名次（1、1、3） */
function top3<T>(items: T[], value: (x: T) => number | string): { rank: number; who: T }[] {
  return items.slice(0, 3).map((x) => ({ rank: items.findIndex((y) => value(y) === value(x)) + 1, who: x }))
}

/** @param gamesPlayed 已有數據的比賽場數（防禦率的局數門檻＝每場 1 局） */
export function leaderboards(lines: LiveLine[], gamesPlayed: number): { bat: Board<BatAgg>[]; pit: Board<PitAgg>[] } {
  const { bats, pits } = aggregate(lines)
  const byH = [...bats].sort((a, b) => b.h - a.h || b.h / (b.ab || 1) - a.h / (a.ab || 1))
  const byHr = bats.filter((x) => x.hr > 0).sort((a, b) => b.hr - a.hr || b.h - a.h)
  const byK = [...pits].sort((a, b) => b.k - a.k || a.outs - b.outs)
  const qualified = pits.filter((x) => x.outs >= gamesPlayed * 3 && x.outs > 0)
    .sort((a, b) => (eraNum(a) ?? 99) - (eraNum(b) ?? 99) || b.outs - a.outs)
  return {
    bat: [
      { title: '安打', key: 'H', note: '', emptyText: '', rows: top3(byH, (x) => x.h).map((r) => ({ ...r, value: String(r.who.h), sub: `${r.who.ab} 打數・${avg(r.who.h, r.who.ab)}` })) },
      { title: '全壘打', key: 'HR', note: '', emptyText: '還沒有人開轟', rows: top3(byHr, (x) => x.hr).map((r) => ({ ...r, value: String(r.who.hr), sub: `${r.who.h} 安` })) },
    ],
    pit: [
      { title: '三振', key: 'K', note: '', emptyText: '', rows: top3(byK, (x) => x.k).map((r) => ({ ...r, value: String(r.who.k), sub: `${ip(r.who.outs)} 局` })) },
      { title: '防禦率', key: 'ERA', note: `至少 ${gamesPlayed} 局`, emptyText: '還沒有投手達到局數門檻',
        rows: top3(qualified, (x) => eraText(x)).map((r) => ({ ...r, value: eraText(r.who), sub: `${ip(r.who.outs)} 局` })) },
    ],
  }
}

// ---- 比賽與戰績列 ----

/** 這場的勝方（只在結束後；平手或未結束為 null） */
export function winnerOf(g: LiveGame): string | null {
  if (g.status !== 'FINAL' || g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return null
  return g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam
}

/** 比賽順序（開賽時間，再來是場次編號） */
export const byOrder = (a: LiveGame, b: LiveGame) =>
  (a.startTime ?? a.scheduledDate).localeCompare(b.startTime ?? b.scheduledDate) || a.sno - b.sno

/** 單場的球員數據 */
export const linesOf = (s: SeriesView, g: LiveGame) => s.lines.filter((l) => l.gameId === g.id)

/** 「第 N 戰後 X：Y」：到這場為止兩隊的勝場（含保送） */
export function standingAfter(s: SeriesView, games: LiveGame[], upto: number): Record<string, number> {
  const w: Record<string, number> = {}
  s.teams.forEach((t) => { w[t] = 0 })
  if (s.advantageTeam && s.advantageTeam in w) w[s.advantageTeam]++
  games.slice(0, upto + 1).forEach((g) => { const t = winnerOf(g); if (t && t in w) w[t]++ })
  return w
}

/** 最多打幾場：三勝制 5 場、四勝制 7 場（含保送的勝場不佔場次） */
export function maxGames(s: SeriesView): number {
  return s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0)
}
