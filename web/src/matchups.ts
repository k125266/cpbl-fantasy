import type { Contribution, Matchup } from './api'

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

/** 對戰期第幾天（1 起算，最多 len）與總天數；today 早於開始日時 day 為 0。 */
export function periodDay(start: string, end: string, today: string): { day: number; len: number } {
  const s = new Date(start).getTime()
  const len = Math.round((new Date(end).getTime() - s) / 86400000) + 1
  const day = Math.min(len, Math.max(0, Math.round((new Date(today).getTime() - s) / 86400000) + 1))
  return { day, len }
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

// ---------- 本期關鍵卡 / 王牌對決 ----------

function isPitcher(c: Contribution) {
  return /\b(SP|RP)\b/.test(c.slots)
}

function ip(outs: number) {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

/**
 * 本期貢獻分（只用來挑關鍵卡，不影響計分）：
 * 打者 R + 2·HR + H + BB；投手 IP + K + 3·QS + 2·(W+SV) − 2·ER。
 */
export function contributionScore(c: Contribution): number {
  const t = c.totals
  if (isPitcher(c)) return t.outs / 3 + t.k + 3 * t.qs + 2 * (t.w + t.sv) - 2 * t.er
  return t.r + 2 * t.hr + t.h + t.bb
}

/** 依貢獻分取前 n 位（分數須大於 0）。 */
export function topContributors(players: Contribution[] | undefined, n: number): Contribution[] {
  return (players ?? [])
    .map((c) => ({ c, s: contributionScore(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.c)
}

/** 球員卡正面的位置、一行摘要與背面四格數據。 */
export function cardStats(c: Contribution): { slot: string; line: string; back: [string, string][] } {
  const t = c.totals
  const slot = c.slots.split(',').find((s) => s !== 'BN' && s !== 'NA') ?? c.slots.split(',')[0] ?? ''
  if (isPitcher(c)) {
    const era = t.outs ? ((t.er * 27) / t.outs).toFixed(2) : '—'
    const wsv = t.w + t.sv
    const parts = [t.qs ? `${t.qs} QS` : '', t.k ? `${t.k} K` : '', wsv ? `${wsv} W+SV` : ''].filter(Boolean).slice(0, 2)
    return {
      slot,
      line: parts.join(' · ') || `${ip(t.outs)} IP`,
      back: [['IP', ip(t.outs)], ['K', String(t.k)], ['ERA', era], slot === 'RP' ? ['W+SV', String(wsv)] : ['QS', String(t.qs)]],
    }
  }
  const avg = t.ab ? (t.h / t.ab).toFixed(3).replace(/^0/, '') : '—'
  const parts = [t.hr ? `${t.hr} HR` : '', t.r ? `${t.r} R` : '', t.bb ? `${t.bb} BB` : ''].filter(Boolean).slice(0, 2)
  return {
    slot,
    line: parts.join(' · ') || `${avg} · ${t.h}-${t.ab}`,
    back: [['H/AB', `${t.h}-${t.ab}`], ['HR', String(t.hr)], ['R', String(t.r)], ['BB', String(t.bb)]],
  }
}

/** 大票根右側的分差，例如 +2、−1、±0。 */
export function diffText(v: MySide): string {
  if (v.me === v.op) return '±0'
  return (v.me > v.op ? '+' : '−') + fmtPts(Math.abs(v.me - v.op))
}
