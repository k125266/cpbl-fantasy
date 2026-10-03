import type { Matchup } from './api'

/** 單場結果（從某一隊的角度）：勝 / 敗 / 和。 */
export type Res = 'W' | 'L' | 'T'

/** 從某一隊角度看的一場對戰。 */
export interface MySide {
  m: Matchup
  side: 'A' | 'B'
  oppSide: 'A' | 'B'
  oppId: number | null
  oppName: string | null
  me: number
  op: number
  result: Res
  /** 已結束（暫定或鎖定）；進行中為 false */
  final: boolean
  live: boolean
  /**
   * 每期雙對手時，我方為 A 的那場對手在圈上的右側，為 B 的那場在左側
   * （賽程配對為 (t[j], t[j+k])，見 SeasonService.ringRounds）。
   */
  neighbour: '左鄰' | '右鄰' | null
}

export function mySide(m: Matchup, teamId: number): MySide {
  const side = m.teamA === teamId ? 'A' : 'B'
  const oppSide = side === 'A' ? 'B' : 'A'
  const me = Number((side === 'A' ? m.scoreA : m.scoreB) ?? 0)
  const op = Number((side === 'A' ? m.scoreB : m.scoreA) ?? 0)
  return {
    m,
    side,
    oppSide,
    oppId: side === 'A' ? m.teamB : m.teamA,
    oppName: side === 'A' ? m.teamBName : m.teamAName,
    me,
    op,
    result: me > op ? 'W' : me < op ? 'L' : 'T',
    final: m.status === 'PROVISIONAL' || m.status === 'LOCKED',
    live: m.status === 'LIVE',
    neighbour: m.kind === 'REGULAR' ? (side === 'A' ? '右鄰' : '左鄰') : null,
  }
}

/** 某隊在某期的所有對戰（每期雙對手時為兩場），依 id 排序。 */
export function myMatchups(all: Matchup[], periodId: number | null | undefined, teamId: number | null | undefined): MySide[] {
  if (periodId == null || teamId == null) return []
  return all
    .filter((m) => m.periodId === periodId && (m.teamA === teamId || m.teamB === teamId))
    .sort((a, b) => a.id - b.id)
    .map((m) => mySide(m, teamId))
}

/** 類別分差文字：整數或 .5（平手、無數據各得 0.5）。 */
export function fmtPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** 小票根的結果說明，例如「領先 2 類」「勝・2 類差」「和局」。 */
export function resultLabel(v: MySide): string {
  const d = fmtPts(Math.abs(v.me - v.op))
  if (v.result === 'W') return v.final ? `勝・${d} 類差` : `領先 ${d} 類`
  if (v.result === 'L') return v.final ? `敗・${d} 類差` : `落後 ${d} 類`
  return v.final ? '和局' : '平手'
}

/** 大票根右側的分差，例如 +2、−1、±0。 */
export function diffText(v: MySide): string {
  if (v.me === v.op) return '±0'
  return (v.me > v.op ? '+' : '−') + fmtPts(Math.abs(v.me - v.op))
}
